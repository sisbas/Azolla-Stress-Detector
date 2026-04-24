from datetime import date, datetime
from pydantic import BaseModel


class ExperimentResponse(BaseModel):
    id: int
    name: str
    description: str | None
    created_at: datetime

    class Config:
        from_attributes = True


class ImageResponse(BaseModel):
    id: int
    experiment_id: int
    file_name: str
    file_path: str
    capture_date: date | None
    date_source: str | None
    plant_area_px: float | None
    plant_area_cm2: float | None
    coverage_ratio: float | None
    stress_score: float | None
    stress_class: str | None

    class Config:
        from_attributes = True
