import logging
from logging.handlers import RotatingFileHandler
import os, sys

LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)


def setup_logging():
    log_format = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"

    handlers = [
        RotatingFileHandler(f"{LOG_DIR}/app.log", maxBytes=10_000_000, backupCount=5),
        logging.StreamHandler(sys.stdout),
    ]

    logging.basicConfig(
        level=logging.INFO, format=log_format, handlers=handlers, force=True
    )

    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
