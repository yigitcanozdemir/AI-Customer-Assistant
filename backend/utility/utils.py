# backend/telemetry.py

from typing import Tuple
import logging
import time
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from prometheus_client import REGISTRY, Counter, Gauge, Histogram
from prometheus_client.openmetrics.exposition import (
    CONTENT_TYPE_LATEST,
    generate_latest,
)
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Match
from starlette.status import HTTP_500_INTERNAL_SERVER_ERROR
from starlette.types import ASGIApp
from backend.config import settings
from opentelemetry.sdk.trace.export import ConsoleSpanExporter


INFO = Gauge("fastapi_app_info", "FastAPI app info", ["app_name"])
REQUESTS = Counter(
    "fastapi_requests_total",
    "Total requests by method and path",
    ["method", "path", "app_name"],
)
RESPONSES = Counter(
    "fastapi_responses_total",
    "Total responses by method, path and status",
    ["method", "path", "status_code", "app_name"],
)
REQUESTS_PROCESSING_TIME = Histogram(
    "fastapi_requests_duration_seconds",
    "Request processing time (seconds)",
    ["method", "path", "app_name"],
)
EXCEPTIONS = Counter(
    "fastapi_exceptions_total",
    "Total exceptions raised by path and exception type",
    ["method", "path", "exception_type", "app_name"],
)
REQUESTS_IN_PROGRESS = Gauge(
    "fastapi_requests_in_progress",
    "Requests in progress by method and path",
    ["method", "path", "app_name"],
)


class PrometheusMiddleware(BaseHTTPMiddleware):

    def __init__(self, app: ASGIApp, app_name: str = "fastapi-service") -> None:
        super().__init__(app)
        self.app_name = app_name
        INFO.labels(app_name=self.app_name).inc()

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        method = request.method
        path, handled = self.get_path(request)
        if not handled:
            return await call_next(request)

        REQUESTS_IN_PROGRESS.labels(
            method=method, path=path, app_name=self.app_name
        ).inc()
        REQUESTS.labels(method=method, path=path, app_name=self.app_name).inc()
        start = time.perf_counter()

        try:
            response = await call_next(request)
        except BaseException as e:
            EXCEPTIONS.labels(
                method=method,
                path=path,
                exception_type=type(e).__name__,
                app_name=self.app_name,
            ).inc()
            status_code = HTTP_500_INTERNAL_SERVER_ERROR
            raise
        else:
            status_code = response.status_code
            duration = time.perf_counter() - start
            span = trace.get_current_span()
            trace_id = trace.format_trace_id(span.get_span_context().trace_id)
            REQUESTS_PROCESSING_TIME.labels(
                method=method, path=path, app_name=self.app_name
            ).observe(duration, exemplar={"TraceID": trace_id})
        finally:
            RESPONSES.labels(
                method=method,
                path=path,
                status_code=status_code,
                app_name=self.app_name,
            ).inc()
            REQUESTS_IN_PROGRESS.labels(
                method=method, path=path, app_name=self.app_name
            ).dec()

        return response

    @staticmethod
    def get_path(request: Request) -> Tuple[str, bool]:
        for route in request.app.routes:
            match, _ = route.matches(request.scope)
            if match == Match.FULL:
                return route.path, True
        return request.url.path, False


def metrics(_: Request) -> Response:
    return Response(
        generate_latest(REGISTRY), headers={"Content-Type": CONTENT_TYPE_LATEST}
    )


def setup_otlp(
    app: ASGIApp,
    app_name: str,
    endpoint: str | None = None,
    environment: str = settings.environment,
) -> None:
    """Wire OpenTelemetry tracing to the configured OTLP backend (OpenObserve).

    The endpoint comes from OTEL_EXPORTER_OTLP_ENDPOINT (falling back to the
    legacy TEMPO_ENDPOINT). Traces cover FastAPI requests plus asyncpg and
    redis calls so a single trace spans the whole request → DB/cache path.
    Enabled in all environments (including production) whenever an endpoint is
    configured; falls back to console spans only in non-production when no
    endpoint is set.
    """
    logger = logging.getLogger(__name__)
    endpoint = endpoint or settings.otel_exporter_otlp_endpoint or settings.tempo_endpoint

    resource = Resource.create(attributes={"service.name": app_name})
    tracer_provider = TracerProvider(resource=resource)

    if endpoint:
        # Pick the exporter transport from OTEL_EXPORTER_OTLP_PROTOCOL:
        #   "http"/"http/protobuf" → OpenObserve, Tempo HTTP, etc. (port 5080/4318)
        #   "grpc" (default)       → gRPC collectors (port 4317)
        protocol = (settings.otel_exporter_otlp_protocol or "grpc").lower()

        # Parse OTEL_EXPORTER_OTLP_HEADERS ("k=v,k2=v2"), the standard OTLP var.
        # OpenObserve rejects unauthenticated ingest with 401 and the exporter
        # retries quietly, so a missing header looks exactly like "tracing is
        # enabled but nothing ever arrives".
        headers: dict[str, str] = {}
        raw_headers = (settings.otel_exporter_otlp_headers or "").strip()
        if raw_headers:
            for pair in raw_headers.split(","):
                key, sep, value = pair.partition("=")
                if sep and key.strip():
                    headers[key.strip()] = value.strip()

        if protocol.startswith("http"):
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
                OTLPSpanExporter as HTTPSpanExporter,
            )

            # The HTTP exporter uses the endpoint verbatim when set explicitly
            # (it does NOT append the OTLP path). Backends like OpenObserve
            # expect the signal path, so ensure the traces path is present.
            http_endpoint = endpoint
            if not http_endpoint.rstrip("/").endswith("/v1/traces"):
                http_endpoint = http_endpoint.rstrip("/") + "/v1/traces"
            exporter = HTTPSpanExporter(
                endpoint=http_endpoint, headers=headers or None
            )
        else:
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
                OTLPSpanExporter as GRPCSpanExporter,
            )

            exporter = GRPCSpanExporter(
                endpoint=endpoint, insecure=True, headers=headers or None
            )

        tracer_provider.add_span_processor(BatchSpanProcessor(exporter))
        logger.info(
            "OTLP tracing enabled → %s (%s, auth=%s)",
            endpoint,
            protocol,
            "yes" if headers else "NONE — backends like OpenObserve will 401",
        )
    elif environment != "production":
        tracer_provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
        logger.info("OTLP endpoint unset; using console span exporter (dev)")

    trace.set_tracer_provider(tracer_provider)

    LoggingInstrumentor().instrument(set_logging_format=True)
    FastAPIInstrumentor.instrument_app(app, tracer_provider=tracer_provider)

    # Database and cache spans — nest under the request span so a trace shows
    # the full request → query / redis path in OpenObserve.
    try:
        from opentelemetry.instrumentation.asyncpg import AsyncPGInstrumentor

        AsyncPGInstrumentor().instrument(tracer_provider=tracer_provider)
    except Exception as exc:  # pragma: no cover - instrumentation is best-effort
        logger.warning("asyncpg instrumentation skipped: %s", exc)

    try:
        from opentelemetry.instrumentation.redis import RedisInstrumentor

        RedisInstrumentor().instrument(tracer_provider=tracer_provider)
    except Exception as exc:  # pragma: no cover
        logger.warning("redis instrumentation skipped: %s", exc)
