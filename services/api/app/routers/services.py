from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.security import require_token
from ..db.models import Service
from ..db.session import get_db
from ..schemas.services import ServiceCreate, ServiceRead, ServiceUpdate

router = APIRouter(prefix="/services", tags=["services"], dependencies=[Depends(require_token)])


def _to_read(service: Service) -> ServiceRead:
    return ServiceRead(
        id=service.id,
        name=service.name,
        description=service.description,
        is_active=service.is_active,
        product_count=len(service.products),
        created_at=service.created_at,
        updated_at=service.updated_at,
    )


@router.get("", response_model=list[ServiceRead])
def list_services(db: Session = Depends(get_db)) -> list[ServiceRead]:
    services = db.query(Service).order_by(Service.name).all()
    return [_to_read(service) for service in services]


@router.post("", response_model=ServiceRead, status_code=201)
def create_service(payload: ServiceCreate, db: Session = Depends(get_db)) -> ServiceRead:
    existing = db.query(Service).filter(Service.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=409, detail="A service with this name already exists.")
    service = Service(**payload.model_dump())
    db.add(service)
    db.commit()
    db.refresh(service)
    return _to_read(service)


@router.get("/{service_id}", response_model=ServiceRead)
def get_service(service_id: str, db: Session = Depends(get_db)) -> ServiceRead:
    service = db.get(Service, service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found.")
    return _to_read(service)


@router.put("/{service_id}", response_model=ServiceRead)
def update_service(service_id: str, payload: ServiceUpdate, db: Session = Depends(get_db)) -> ServiceRead:
    service = db.get(Service, service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found.")
    duplicate = db.query(Service).filter(Service.name == payload.name, Service.id != service_id).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="A service with this name already exists.")
    for field, value in payload.model_dump().items():
        setattr(service, field, value)
    db.commit()
    db.refresh(service)
    return _to_read(service)


@router.delete("/{service_id}", status_code=204)
def delete_service(service_id: str, db: Session = Depends(get_db)) -> None:
    service = db.get(Service, service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found.")
    if service.products:
        raise HTTPException(status_code=409, detail="Remove the products in this service before removing the service.")
    db.delete(service)
    db.commit()
