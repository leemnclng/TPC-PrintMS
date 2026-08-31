from __future__ import annotations

import logging
import sys
import threading
from logging.handlers import RotatingFileHandler
from pathlib import Path


_configured_path: Path | None = None


def configure_backend_logging(log_path: Path, level_name: str) -> Path:
    """Configure one console + rotating-file pipeline before heavy imports."""
    global _configured_path
    if _configured_path == log_path:
        return log_path

    log_path.parent.mkdir(parents=True, exist_ok=True)
    level = getattr(logging, level_name.upper(), logging.INFO)
    formatter = logging.Formatter(
        "%(asctime)s.%(msecs)03d %(levelname)s pid=%(process)d thread=%(threadName)s %(name)s | %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    console = logging.StreamHandler(sys.stderr)
    console.setLevel(level)
    console.setFormatter(formatter)
    file_handler = RotatingFileHandler(
        log_path,
        maxBytes=5 * 1024 * 1024,
        backupCount=4,
        encoding="utf-8",
    )
    file_handler.setLevel(level)
    file_handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(level)
    root.addHandler(console)
    root.addHandler(file_handler)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("alembic.runtime.plugins").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    _configured_path = log_path

    original_excepthook = sys.__excepthook__

    def log_uncaught(error_type: type[BaseException], error: BaseException, traceback: object) -> None:
        logging.getLogger("app.crash").critical(
            "Uncaught backend exception",
            exc_info=(error_type, error, traceback),
        )
        original_excepthook(error_type, error, traceback)

    def log_thread_exception(args: threading.ExceptHookArgs) -> None:
        logging.getLogger("app.crash").critical(
            "Uncaught background-thread exception thread=%s",
            args.thread.name if args.thread else "unknown",
            exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
        )

    sys.excepthook = log_uncaught
    threading.excepthook = log_thread_exception
    return log_path
