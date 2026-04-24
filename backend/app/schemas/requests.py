from datetime import date
from pydantic import BaseModel, Field


class ExperimentCreate(BaseModel):
    name: str
    description: str | None = None


class AnalyzeRequest(BaseModel):
    manual_date: date | None = None


class RoiPayload(BaseModel):
    x: int
    y: int
    width: int
    height: int


class MaskUpdateRequest(BaseModel):
    roi: RoiPayload | None = None
    mask_base64: str | None = None


class CompareRequest(BaseModel):
    image_id_t1: int
    image_id_t2: int


class CalibrationDataCreate(BaseModel):
    image_id: int | None = None
    fresh_weight_g: float = Field(gt=0)
    plant_area_px: float
    plant_area_cm2: float
    coverage_ratio: float
    mean_g: float
    gli: float
    exg: float
    redness_index: float
    color_heterogeneity: float
