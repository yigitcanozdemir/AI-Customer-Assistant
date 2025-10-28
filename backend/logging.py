# backend/logging.py
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


class OtelLogRecord(logging.LogRecord):
    """Custom LogRecord that adds OpenTelemetry fields"""

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


class CustomLoggerAdapter(logging.LoggerAdapter):

    def makeRecord(
        self,
        name,
        level,
        fn,
        lno,
        msg,
        args,
        exc_info,
        func=None,
        extra=None,
        sinfo=None,
    ):
        rv = OtelLogRecord(name, level, fn, lno, msg, args, exc_info, func, sinfo)
        if extra is not None:
            for key in extra:
                rv.__dict__[key] = extra[key]
        return rv


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

    if log_format == "text":
        fmt = (
            "%(asctime)s %(levelname)s %(name)s %(filename)s:%(lineno)d "
            "[trace_id=%(otelTraceID)s span_id=%(otelSpanID)s resource.service.name=%(otelServiceName)s] - %(message)s"
        )
        formatter = logging.Formatter(fmt, datefmt="%Y-%m-%d %H:%M:%S")
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

    logging.getLogger("uvicorn.access").setLevel(logging.INFO)
    logging.getLogger("uvicorn.error").setLevel(logging.INFO)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    uvicorn_logger = logging.getLogger("uvicorn")
    uvicorn_logger.handlers = []
    uvicorn_logger.propagate = True

    logging.getLogger(__name__).info(f"Logging configured (format={log_format})")
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "uvicorn.server"):
        logging.getLogger(name).setLevel(logging.WARNING)


setup_logging()
