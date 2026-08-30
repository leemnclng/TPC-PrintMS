from __future__ import annotations

import socket
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import settings
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
    services,
    settings as settings_router,
    variants,
)
from .seed import seed_business_profile
from .services.backup_restore import write_environment_config
from .services.product_deletion import finalize_expired_product_deletions
from .services.printing.spooler_monitor import spooler_monitor

# Set by run() before uvicorn starts, read by lifespan() once startup
# (migrations + seed) has actually finished — see the note on lifespan below.
_runtime: dict[str, int] = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    run_migrations()
    with SessionLocal() as db:
        seed_business_profile(db)
        finalize_expired_product_deletions(db)
        write_environment_config(db.query(BusinessProfile).first())

    if settings.resolved_printer_platform == "windows":
        spooler_monitor.start()

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

    try:
        yield
    finally:
        spooler_monitor.stop()


app = FastAPI(title="Printing-MS API", version=settings.version, lifespan=lifespan)

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
app.include_router(job_orders.router)
app.include_router(printers.router)
app.include_router(settings_router.router)


def run() -> None:
    """Entry point used by `uv run python -m app.main` and by the bundled
    executable Electron spawns in production."""
    import uvicorn

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((settings.host, settings.port))
        _runtime["port"] = probe.getsockname()[1]

    server_config = uvicorn.Config(app, host=settings.host, port=_runtime["port"], log_level="info")
    uvicorn.Server(server_config).run()


if __name__ == "__main__":
    run()
