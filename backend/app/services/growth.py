from __future__ import annotations

import math
from datetime import date

import numpy as np


def calculate_plant_area(mask: np.ndarray) -> int:
    return int((mask > 0).sum())


def calculate_coverage_ratio(mask: np.ndarray, roi: dict[str, int]) -> float:
    roi_area = max(roi.get("width", 0) * roi.get("height", 0), 1)
    return float(calculate_plant_area(mask) / roi_area)


def calculate_area_based_rgr(area_t1: float, area_t2: float, days: int) -> float:
    if area_t1 <= 0 or area_t2 <= 0 or days <= 0:
        return 0.0
    return float((math.log(area_t2) - math.log(area_t1)) / days)


def compare_two_images(area_t1: float, area_t2: float, date_t1: date, date_t2: date) -> dict:
    days = max((date_t2 - date_t1).days, 1)
    change = area_t2 - area_t1
    change_pct = ((change / area_t1) * 100) if area_t1 > 0 else 0.0
    return {
        "days": days,
        "area_change": change,
        "area_change_percent": change_pct,
        "area_based_rgr": calculate_area_based_rgr(area_t1, area_t2, days),
        "note": "Area-based growth indicator; not direct biomass.",
    }
