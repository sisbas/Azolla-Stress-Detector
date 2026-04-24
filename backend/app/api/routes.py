from __future__ import annotations

import base64
import json
import shutil
from datetime import date
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.entities import CalibrationRecord, Experiment, ImageRecord
from app.schemas.requests import CalibrationDataCreate, CompareRequest, ExperimentCreate, MaskUpdateRequest
from app.schemas.responses import ExperimentResponse
from app.services.calibration import FEATURES, train_biomass_models
from app.services.growth import compare_two_images
from app.services.qc import evaluate_quality
from app.services.segmentation import (
    extract_roi,
    load_image,
    parse_date_from_filename,
    read_exif_date,
    roi_to_json,
    segment_azolla,
)
from app.services.stress import compute_indices, compute_stress_score
from app.services.timeline import build_growth_timeline, build_stress_timeline, detect_anomalies

router = APIRouter()


@router.post("/experiments", response_model=ExperimentResponse)
def create_experiment(payload: ExperimentCreate, db: Session = Depends(get_db)):
    exp = Experiment(name=payload.name, description=payload.description)
    db.add(exp)
    db.commit()
    db.refresh(exp)
    return exp


@router.post("/experiments/{experiment_id}/images")
def upload_image(experiment_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    exp = db.get(Experiment, experiment_id)
    if not exp:
        raise HTTPException(404, "Experiment not found")

    exp_dir = settings.upload_dir / str(experiment_id)
    exp_dir.mkdir(parents=True, exist_ok=True)
    destination = exp_dir / file.filename
    with destination.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    capture_date = read_exif_date(destination) or parse_date_from_filename(file.filename)
    date_source = "exif_or_filename" if capture_date else None

    image = ImageRecord(
        experiment_id=experiment_id,
        file_name=file.filename,
        file_path=str(destination),
        capture_date=capture_date,
        date_source=date_source,
    )
    db.add(image)
    db.commit()
    db.refresh(image)
    return {"id": image.id, "capture_date": capture_date, "date_source": date_source}


@router.post("/images/{image_id}/analyze")
def analyze_image(image_id: int, db: Session = Depends(get_db)):
    image_rec = db.get(ImageRecord, image_id)
    if not image_rec:
        raise HTTPException(404, "Image not found")

    seg = segment_azolla(image_rec.file_path, settings.processed_dir / str(image_rec.experiment_id))
    mask = cv2.imread(seg["mask_path"], cv2.IMREAD_GRAYSCALE) > 0
    rgb = load_image(image_rec.file_path)

    roi = seg["roi"]
    area_px = float(seg["plant_area_px"])
    area_cm2 = (area_px * (image_rec.scale_cm_per_px ** 2)) if image_rec.scale_cm_per_px else None
    coverage_ratio = area_px / max(roi["width"] * roi["height"], 1)
    idx = compute_indices(rgb, mask)

    baseline = (
        db.query(ImageRecord)
        .filter(ImageRecord.experiment_id == image_rec.experiment_id, ImageRecord.stress_score.isnot(None))
        .order_by(ImageRecord.capture_date.asc(), ImageRecord.id.asc())
        .first()
    )
    if baseline and baseline.indices_json:
        baseline_idx = json.loads(baseline.indices_json)
        stress = compute_stress_score(baseline_idx, idx)
    else:
        stress = {"StressScore": 0.0, "StressClass": "Normal", "components": {}}

    flags = evaluate_quality(rgb, mask, image_rec.capture_date is not None, image_rec.scale_cm_per_px is not None)

    image_rec.mask_path = seg["mask_path"]
    image_rec.segmented_image_path = seg["segmented_image_path"]
    image_rec.roi_json = roi_to_json(roi)
    image_rec.plant_area_px = area_px
    image_rec.plant_area_cm2 = area_cm2
    image_rec.coverage_ratio = coverage_ratio
    image_rec.indices_json = json.dumps(idx)
    image_rec.stress_score = stress["StressScore"]
    image_rec.stress_class = stress["StressClass"]
    image_rec.quality_flags = json.dumps(flags, ensure_ascii=False)

    db.commit()
    return {**seg, "plant_area_cm2": area_cm2, "coverage_ratio": coverage_ratio, "indices": idx, "stress": stress, "quality_flags": flags}


@router.put("/images/{image_id}/mask")
def update_mask(image_id: int, payload: MaskUpdateRequest, db: Session = Depends(get_db)):
    image_rec = db.get(ImageRecord, image_id)
    if not image_rec:
        raise HTTPException(404, "Image not found")
    if payload.roi:
        image_rec.roi_json = payload.roi.model_dump_json()
    if payload.mask_base64 and image_rec.mask_path:
        data = payload.mask_base64.split(",")[-1]
        decoded = base64.b64decode(data)
        Path(image_rec.mask_path).write_bytes(decoded)
        mask = cv2.imdecode(np.frombuffer(decoded, np.uint8), cv2.IMREAD_GRAYSCALE)
        if mask is not None:
            image_rec.plant_area_px = float((mask > 0).sum())
            image_rec.roi_json = json.dumps(extract_roi(mask > 0))
    db.commit()
    return {"ok": True}


@router.get("/experiments/{experiment_id}/timeline")
def get_timeline(experiment_id: int, db: Session = Depends(get_db)):
    records = db.query(ImageRecord).filter(ImageRecord.experiment_id == experiment_id).all()
    parsed = [
        {
            "id": r.id,
            "capture_date": r.capture_date or date.min,
            "plant_area_px": r.plant_area_px,
            "coverage_ratio": r.coverage_ratio,
            "stress_score": r.stress_score,
            "indices": json.loads(r.indices_json) if r.indices_json else {},
        }
        for r in records
    ]
    return {
        "growth": build_growth_timeline(parsed),
        "stress": build_stress_timeline(parsed),
        "anomalies": detect_anomalies(parsed),
    }


@router.post("/experiments/{experiment_id}/compare")
def compare_images(experiment_id: int, payload: CompareRequest, db: Session = Depends(get_db)):
    t1 = db.get(ImageRecord, payload.image_id_t1)
    t2 = db.get(ImageRecord, payload.image_id_t2)
    if not t1 or not t2 or t1.experiment_id != experiment_id or t2.experiment_id != experiment_id:
        raise HTTPException(404, "Images not found")
    if not t1.capture_date or not t2.capture_date:
        raise HTTPException(400, "Both images must have capture date")
    return compare_two_images(t1.plant_area_px or 0, t2.plant_area_px or 0, t1.capture_date, t2.capture_date)


@router.post("/experiments/{experiment_id}/calibration-data")
def add_calibration_data(experiment_id: int, payload: CalibrationDataCreate, db: Session = Depends(get_db)):
    rec = CalibrationRecord(experiment_id=experiment_id, **payload.model_dump())
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return {"id": rec.id}


@router.post("/experiments/{experiment_id}/train-biomass-model")
def train_model(experiment_id: int, db: Session = Depends(get_db)):
    rows = db.query(CalibrationRecord).filter(CalibrationRecord.experiment_id == experiment_id).all()
    records = [
        {
            "fresh_weight_g": r.fresh_weight_g,
            "plant_area_px": r.plant_area_px,
            "plant_area_cm2": r.plant_area_cm2,
            "coverage_ratio": r.coverage_ratio,
            "mean_g": r.mean_g,
            "GLI": r.gli,
            "ExG": r.exg,
            "RednessIndex": r.redness_index,
            "ColorHeterogeneity": r.color_heterogeneity,
        }
        for r in rows
    ]
    model_result = train_biomass_models(records)
    return {"features": FEATURES, **model_result}


@router.get("/experiments/{experiment_id}/export")
def export_experiment(experiment_id: int, db: Session = Depends(get_db)):
    rows = db.query(ImageRecord).filter(ImageRecord.experiment_id == experiment_id).all()
    out_path = settings.export_dir / f"experiment_{experiment_id}.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(
        [
            {
                "id": r.id,
                "file_name": r.file_name,
                "capture_date": r.capture_date,
                "plant_area_px": r.plant_area_px,
                "plant_area_cm2": r.plant_area_cm2,
                "coverage_ratio": r.coverage_ratio,
                "stress_score": r.stress_score,
                "stress_class": r.stress_class,
            }
            for r in rows
        ]
    ).to_csv(out_path, index=False)
    return {"csv_path": str(out_path)}
