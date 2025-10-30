import logging
import sys
import json
import os
from datetime import datetime
from typing import Any, Dict

try:
    from opentelemetry import trace
except Exception:
    trace = None

try:
    import boto3
    import watchtower

    CLOUDWATCH_AVAILABLE = True
except ImportError:
    CLOUDWATCH_AVAILABLE = False


class OtelLogRecord(logging.LogRecord):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if trace:
            try:
                span = trace.get_current_span()
                ctx = span.get_span_context()
                if ctx and ctx.trace_id:
                    self.otelTraceID = trace.format_trace_id(ctx.trace_id)
                    self.otelSpanID = (
                        format(ctx.span_id, "016x")
                        if hasattr(ctx, "span_id")
                        else "N/A"
                    )
                    self.otelServiceName = os.environ.get(
                        "OTEL_SERVICE_NAME", "unknown"
                    )
                else:
                    self._set_defaults()
            except Exception:
                self._set_defaults()
        else:
            self._set_defaults()

    def _set_defaults(self):
        self.otelTraceID = "N/A"
        self.otelSpanID = "N/A"
        self.otelServiceName = os.environ.get("OTEL_SERVICE_NAME", "unknown")


class JsonFormatter(logging.Formatter):
    def formatTime(self, record, datefmt=None):
        return datetime.utcfromtimestamp(record.created).isoformat() + "Z"

    def format(self, record: logging.LogRecord) -> str:
        log_record: Dict[str, Any] = {
            "timestamp": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "filename": record.filename,
            "lineno": record.lineno,
            "funcName": record.funcName,
        }

        if record.exc_info:
            log_record["exception"] = self.formatException(record.exc_info)

        if hasattr(record, "otelTraceID"):
            log_record["otelTraceID"] = record.otelTraceID
        if hasattr(record, "otelSpanID"):
            log_record["otelSpanID"] = record.otelSpanID
        if hasattr(record, "otelServiceName"):
            log_record["otelServiceName"] = record.otelServiceName

        skip_attrs = {
            "name",
            "msg",
            "args",
            "created",
            "msecs",
            "levelname",
            "levelno",
            "pathname",
            "filename",
            "module",
            "exc_info",
            "exc_text",
            "stack_info",
            "lineno",
            "funcName",
            "processName",
            "process",
            "threadName",
            "thread",
            "getMessage",
            "otelTraceID",
            "otelSpanID",
            "otelServiceName",
        }

        for key, value in record.__dict__.items():
            if key not in skip_attrs and not key.startswith("_"):
                try:
                    json.dumps(value)
                    log_record[key] = value
                except (TypeError, ValueError):
                    log_record[key] = str(value)

        return json.dumps(log_record, ensure_ascii=False)


class ProductionJsonFormatter(JsonFormatter):
    def format(self, record: logging.LogRecord) -> str:
        if record.levelno < logging.INFO:
            return ""

        if any(
            skip in record.getMessage()
            for skip in [
                "GET /health",
                "OPTIONS /",
            ]
        ):
            return ""

        return super().format(record)


def setup_logging(force: bool = True, level: str = None) -> None:
    logging.setLogRecordFactory(OtelLogRecord)

    root = logging.getLogger()

    if root.handlers:
        for h in list(root.handlers):
            try:
                root.removeHandler(h)
                h.close()
            except Exception:
                pass

    for name in list(logging.Logger.manager.loggerDict.keys()):
        try:
            logger = logging.getLogger(name)
            logger.handlers = []
            logger.propagate = True
        except Exception:
            pass

    console_handler = logging.StreamHandler(sys.stdout)

    log_format = os.environ.get("LOG_FORMAT", "json").lower()
    environment = os.environ.get("ENVIRONMENT", "development")
    use_cloudwatch = os.environ.get("USE_CLOUDWATCH", "false").lower() == "true"

    if log_format == "text":
        fmt = (
            "%(asctime)s %(levelname)s %(name)s %(filename)s:%(lineno)d "
            "[trace_id=%(otelTraceID)s span_id=%(otelSpanID)s resource.service.name=%(otelServiceName)s] - %(message)s"
        )
        formatter = logging.Formatter(fmt, datefmt="%Y-%m-%d %H:%M:%S")
    else:
        if environment == "production":
            formatter = ProductionJsonFormatter()
        else:
            formatter = JsonFormatter()

    console_handler.setFormatter(formatter)

    env_level = os.environ.get("LOG_LEVEL", "INFO")
    chosen_level = (level or env_level).upper()

    try:
        numeric_level = getattr(logging, chosen_level)
    except Exception:
        numeric_level = logging.INFO

    console_handler.setLevel(numeric_level)
    root.setLevel(numeric_level)
    root.addHandler(console_handler)

    if use_cloudwatch and CLOUDWATCH_AVAILABLE and environment == "production":
        try:
            aws_region = os.environ.get("AWS_REGION", "us-east-1")
            log_group = f"/aws/ec2/{os.environ.get('APP_NAME', 'ecommerce-api')}"

            cloudwatch_handler = watchtower.CloudWatchLogHandler(
                log_group=log_group,
                stream_name="{machine_name}/{program_name}/{logger_name}",
                use_queues=True,
                send_interval=10,
                boto3_client=boto3.client("logs", region_name=aws_region),
            )
            cloudwatch_handler.setFormatter(formatter)
            cloudwatch_handler.setLevel(logging.WARNING)
            root.addHandler(cloudwatch_handler)

            logging.getLogger(__name__).info(
                f"CloudWatch logging enabled (log_group={log_group}, region={aws_region})"
            )
        except Exception as e:
            logging.getLogger(__name__).warning(
                f"Failed to set up CloudWatch logging: {e}"
            )

    if environment == "production":
        logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
        logging.getLogger("uvicorn.error").setLevel(logging.WARNING)
        logging.getLogger("sqlalchemy.engine").setLevel(logging.ERROR)
        logging.getLogger("watchtower").setLevel(logging.ERROR)
        logging.getLogger("botocore").setLevel(logging.ERROR)
        logging.getLogger("boto3").setLevel(logging.ERROR)
    else:
        logging.getLogger("uvicorn.access").setLevel(logging.INFO)
        logging.getLogger("uvicorn.error").setLevel(logging.INFO)
        logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    uvicorn_logger = logging.getLogger("uvicorn")
    uvicorn_logger.handlers = []
    uvicorn_logger.propagate = True

    logging.getLogger(__name__).info(
        f"Logging configured (format={log_format}, environment={environment}, cloudwatch={use_cloudwatch})"
    )

    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "uvicorn.server"):
        logging.getLogger(name).setLevel(
            logging.WARNING if environment == "production" else logging.INFO
        )


setup_logging()
