from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_db
from app.routers import maintenance


def _client(tmp_path) -> tuple[TestClient, dict[str, str]]:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'maintenance.db'}",
        connect_args={"check_same_thread": False},
    )
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)

    def override_db():
        with test_session() as db:
            yield db

    app = FastAPI()
    app.dependency_overrides[get_db] = override_db
    app.include_router(maintenance.router)
    return TestClient(app), {"X-Print-MS-Token": settings.token}


def test_reminder_lifecycle_and_active_filter(tmp_path) -> None:
    client, headers = _client(tmp_path)

    created = client.post(
        "/maintenance-reminders",
        headers=headers,
        json={"message": "  Print a small   color page weekly.  ", "isActive": True},
    )
    assert created.status_code == 201
    reminder = created.json()
    assert reminder["message"] == "Print a small color page weekly."

    updated = client.put(
        f"/maintenance-reminders/{reminder['id']}",
        headers=headers,
        json={"message": "Check the nozzle pattern first.", "isActive": False},
    )
    assert updated.status_code == 200
    assert updated.json()["isActive"] is False
    assert client.get("/maintenance-reminders?active_only=true", headers=headers).json() == []
    assert len(client.get("/maintenance-reminders", headers=headers).json()) == 1

    deleted = client.delete(f"/maintenance-reminders/{reminder['id']}", headers=headers)
    assert deleted.status_code == 204
    assert client.get("/maintenance-reminders", headers=headers).json() == []


def test_reminder_validation_and_missing_record(tmp_path) -> None:
    client, headers = _client(tmp_path)

    invalid = client.post("/maintenance-reminders", headers=headers, json={"message": "  x  "})
    assert invalid.status_code == 422

    missing = client.put(
        "/maintenance-reminders/missing",
        headers=headers,
        json={"message": "Keep the printer powered correctly.", "isActive": True},
    )
    assert missing.status_code == 404
