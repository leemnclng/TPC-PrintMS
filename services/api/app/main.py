from __future__ import annotations

import asyncio
import logging
import platform
import socket
import sys
import time
from contextlib import asynccontextmanager
from contextlib import contextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import settings
from .core.logging import configure_backend_logging

_module_import_started_at = time.perf_counter()
configure_backend_logging(settings.resolved_backend_log_path, settings.log_level)
logger = logging.getLogger(__name__)

from .db.models import BusinessProfile
from .db.migrations import run_migrations
from .db.session import SessionLocal
from .modules.document_analyzer import router as document_analyzer_router
from .routers import (
    customers,
    health,
    inventory,
    job_orders,
    overview,
    print_types,
    printers,
    products,
    quotations,
    reports,
    services,
    settings as settings_router,
    variants,
)
from .seed import seed_business_profile
from .services.backup_restore import write_environment_config
from .services.product_deletion import finalize_expired_product_deletions
from .services.printing.spooler_monitor import spooler_monitor

logger.info(
    "startup.phase.complete phase=module_imports duration_ms=%.1f",
    (time.perf_counter() - _module_import_started_at) * 1000,
)

# Set by run() before uvicorn starts, read by lifespan() once startup
# (migrations + seed) has actually finished — see the note on lifespan below.
_runtime: dict[str, int] = {}


@contextmanager
def startup_phase(name: str):
    started_at = time.perf_counter()
    logger.info("startup.phase.begin phase=%s", name)
    try:
        yield
    except Exception:
        logger.exception(
            "startup.phase.failed phase=%s duration_ms=%.1f",
            name,
            (time.perf_counter() - started_at) * 1000,
        )
        raise
    logger.info(
        "startup.phase.complete phase=%s duration_ms=%.1f",
        name,
        (time.perf_counter() - started_at) * 1000,
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    lifespan_started_at = time.perf_counter()
    logger.info(
        "startup.begin version=%s stage=%s python=%s executable=%s platform=%s printer_platform=%s "
        "database=%s data_dir=%s log=%s",
        settings.version,
        settings.stage,
        sys.version.split()[0],
        sys.executable,
        platform.platform(),
        settings.resolved_printer_platform,
        settings.resolved_database_path,
        settings.resolved_data_dir,
        settings.resolved_backend_log_path,
    )
    with startup_phase("database_migrations"):
        run_migrations()
    with startup_phase("seed_and_catalog_cleanup"):
        with SessionLocal() as db:
            seed_business_profile(db)
            finalized_products = finalize_expired_product_deletions(db)
            profile = db.query(BusinessProfile).first()
        logger.info("startup.catalog_cleanup finalized_products=%d", finalized_products)

    async def refresh_environment_snapshot() -> None:
        started_at = time.perf_counter()
        try:
            await asyncio.to_thread(write_environment_config, profile)
            logger.info(
                "maintenance.phase.complete phase=config_snapshot duration_ms=%.1f",
                (time.perf_counter() - started_at) * 1000,
            )
        except OSError:
            logger.warning(
                "maintenance.phase.failed phase=config_snapshot duration_ms=%.1f",
                (time.perf_counter() - started_at) * 1000,
                exc_info=True,
            )

    # The JSON mirror is informational and Windows may retry a locked file for
    # several seconds. Run it after readiness so it cannot delay the UI.
    config_snapshot_task = asyncio.create_task(refresh_environment_snapshot())

    if settings.resolved_printer_platform == "windows":
        with startup_phase("windows_spooler_monitor"):
            spooler_monitor.start()
            logger.info(
                "startup.spooler_monitor active=%s error=%s",
                spooler_monitor.active,
                spooler_monitor.error,
            )

    # Electron's backend-manager reads these two lines from stdout to learn
    # the OS-assigned port and the per-launch auth token — see
    # apps/desktop/src/backendManager.ts. Printing them here, at the very end
    # of lifespan startup, matters: uvicorn only starts accepting requests
    # once this coroutine reaches `yield`, so any request Electron fires the
    # instant it sees these lines is guaranteed to land on a server that has
    # already migrated and seeded the database. Printing them earlier (e.g.
    # right after finding a free port, before `uvicorn.run`) was tried first
    # and lost the race — the renderer would get a valid port+token and
    # immediately hit connection-refused or a not-yet-migrated database.
    print(f"PRINT_MS_PORT={_runtime['port']}", flush=True)
    print(f"PRINT_MS_TOKEN={settings.token}", flush=True)
    logger.info(
        "startup.ready duration_ms=%.1f port=%d",
        (time.perf_counter() - lifespan_started_at) * 1000,
        _runtime["port"],
    )

    try:
        yield
    finally:
        shutdown_started_at = time.perf_counter()
        logger.info("shutdown.begin")
        await config_snapshot_task
        spooler_monitor.stop()
        logger.info("shutdown.complete duration_ms=%.1f", (time.perf_counter() - shutdown_started_at) * 1000)


app = FastAPI(title="Printing-MS API", version=settings.version, lifespan=lifespan)


@app.middleware("http")
async def log_slow_or_failed_request(request, call_next):
    started_at = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "request.failed method=%s path=%s duration_ms=%.1f",
            request.method,
            request.url.path,
            (time.perf_counter() - started_at) * 1000,
        )
        raise
    duration_ms = (time.perf_counter() - started_at) * 1000
    if duration_ms >= 1000:
        logger.warning(
            "request.slow method=%s path=%s status=%d duration_ms=%.1f",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
    else:
        logger.debug(
            "request.complete method=%s path=%s status=%d duration_ms=%.1f",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
    return response

# Renderer is loaded from file:// in production and http://localhost:5173 in
# dev; both are local-only per docs/context/decisions.md.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "file://"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(overview.router)
app.include_router(customers.router)
app.include_router(services.router)
app.include_router(variants.router)
app.include_router(print_types.router)
app.include_router(document_analyzer_router)
app.include_router(products.router)
app.include_router(inventory.router)
app.include_router(quotations.router)
app.include_router(reports.router)
app.include_router(job_orders.router)
app.include_router(printers.router)
app.include_router(settings_router.router)


def run() -> None:
    """Entry point used by `uv run python -m app.main` and by the bundled
    executable Electron spawns in production."""
    import uvicorn

    process_started_at = time.perf_counter()
    try:
        with startup_phase("port_allocation"):
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.bind((settings.host, settings.port))
                _runtime["port"] = probe.getsockname()[1]

        server_config = uvicorn.Config(
            app,
            host=settings.host,
            port=_runtime["port"],
            log_level=settings.log_level.lower(),
            log_config=None,
        )
        uvicorn.Server(server_config).run()
    except BaseException as error:
        if isinstance(error, (KeyboardInterrupt, SystemExit)):
            logger.info("backend.process.interrupted type=%s", type(error).__name__)
        else:
            logger.exception("backend.process.crashed uptime_ms=%.1f", (time.perf_counter() - process_started_at) * 1000)
        raise
    finally:
        logger.info("backend.process.exit uptime_ms=%.1f", (time.perf_counter() - process_started_at) * 1000)


if __name__ == "__main__":
    run()
