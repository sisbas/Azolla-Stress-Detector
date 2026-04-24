from __future__ import annotations

from statistics import mean, pstdev

from app.services.growth import calculate_area_based_rgr


def sort_images_by_date(records: list[dict]) -> list[dict]:
    return sorted(records, key=lambda x: x.get("capture_date") or "")


def build_growth_timeline(records: list[dict]) -> list[dict]:
    sorted_records = sort_images_by_date(records)
    result: list[dict] = []
    for i, item in enumerate(sorted_records):
        rgr = 0.0
        if i > 0:
            prev = sorted_records[i - 1]
            days = max((item["capture_date"] - prev["capture_date"]).days, 1)
            rgr = calculate_area_based_rgr(prev.get("plant_area_px", 0) or 0, item.get("plant_area_px", 0) or 0, days)
        result.append({
            "date": item["capture_date"],
            "area_px": item.get("plant_area_px"),
            "coverage_ratio": item.get("coverage_ratio"),
            "area_based_rgr": rgr,
        })
    return result


def build_stress_timeline(records: list[dict]) -> list[dict]:
    sorted_records = sort_images_by_date(records)
    return [
        {
            "date": r["capture_date"],
            "stress_score": r.get("stress_score", 0),
            "GLI": (r.get("indices") or {}).get("GLI"),
            "RednessIndex": (r.get("indices") or {}).get("RednessIndex"),
            "YellowingIndex": (r.get("indices") or {}).get("YellowingIndex"),
        }
        for r in sorted_records
    ]


def detect_anomalies(records: list[dict]) -> list[dict]:
    scores = [r.get("stress_score", 0) for r in records if r.get("stress_score") is not None]
    if len(scores) < 3:
        return []
    mu, sigma = mean(scores), pstdev(scores) or 1
    alerts = []
    for r in records:
        score = r.get("stress_score")
        if score is None:
            continue
        z = (score - mu) / sigma
        if z > 2:
            alerts.append({"image_id": r["id"], "capture_date": r["capture_date"], "stress_score": score, "z_score": z})
    return alerts
