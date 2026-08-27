from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_db
from app.routers import settings as settings_router


def test_owner_name_can_be_configured(tmp_path) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'settings.db'}",
        connect_args={"check_same_thread": False},
    )
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)

    def override_db():
        with test_session() as db:
            yield db

    app = FastAPI()
    app.dependency_overrides[get_db] = override_db
    app.include_router(settings_router.router)
    client = TestClient(app)
    headers = {"X-Print-MS-Token": settings.token}

    profile = client.get("/settings/business-profile", headers=headers).json()
    profile["ownerName"] = "  Lee Maneclang  "
    updated = client.put("/settings/business-profile", headers=headers, json=profile)

    assert updated.status_code == 200
    assert updated.json()["ownerName"] == "Lee Maneclang"
