from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Experiment(Base):
    __tablename__ = "experiments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    images: Mapped[list[ImageRecord]] = relationship("ImageRecord", back_populates="experiment", cascade="all,delete")
    calibration_points: Mapped[list[CalibrationRecord]] = relationship(
        "CalibrationRecord", back_populates="experiment", cascade="all,delete"
    )


class ImageRecord(Base):
    __tablename__ = "images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    experiment_id: Mapped[int] = mapped_column(ForeignKey("experiments.id"), index=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    capture_date: Mapped[date | None] = mapped_column(Date)
    date_source: Mapped[str | None] = mapped_column(String(32))
    scale_cm_per_px: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    mask_path: Mapped[str | None] = mapped_column(String(500))
    segmented_image_path: Mapped[str | None] = mapped_column(String(500))
    roi_json: Mapped[str | None] = mapped_column(Text)
    plant_area_px: Mapped[float | None] = mapped_column(Float)
    plant_area_cm2: Mapped[float | None] = mapped_column(Float)
    coverage_ratio: Mapped[float | None] = mapped_column(Float)
    stress_score: Mapped[float | None] = mapped_column(Float)
    stress_class: Mapped[str | None] = mapped_column(String(64))
    quality_flags: Mapped[str | None] = mapped_column(Text)
    indices_json: Mapped[str | None] = mapped_column(Text)

    experiment: Mapped[Experiment] = relationship("Experiment", back_populates="images")


class CalibrationRecord(Base):
    __tablename__ = "calibration_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    experiment_id: Mapped[int] = mapped_column(ForeignKey("experiments.id"), index=True)
    image_id: Mapped[int | None] = mapped_column(ForeignKey("images.id"), nullable=True)
    fresh_weight_g: Mapped[float] = mapped_column(Float, nullable=False)
    plant_area_px: Mapped[float] = mapped_column(Float, nullable=False)
    plant_area_cm2: Mapped[float] = mapped_column(Float, nullable=False)
    coverage_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    mean_g: Mapped[float] = mapped_column(Float, nullable=False)
    gli: Mapped[float] = mapped_column(Float, nullable=False)
    exg: Mapped[float] = mapped_column(Float, nullable=False)
    redness_index: Mapped[float] = mapped_column(Float, nullable=False)
    color_heterogeneity: Mapped[float] = mapped_column(Float, nullable=False)

    experiment: Mapped[Experiment] = relationship("Experiment", back_populates="calibration_points")
