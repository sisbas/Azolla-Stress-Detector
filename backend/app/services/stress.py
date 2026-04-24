from __future__ import annotations

import numpy as np

EPS = 1e-6


def _masked_pixels(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    pixels = image[mask > 0].astype(np.float32)
    if pixels.size == 0:
        return np.zeros((1, 3), dtype=np.float32)
    return pixels


def compute_indices(image: np.ndarray, mask: np.ndarray) -> dict[str, float]:
    p = _masked_pixels(image, mask)
    r, g, b = p[:, 0], p[:, 1], p[:, 2]
    mean_r, mean_g, mean_b = float(r.mean()), float(g.mean()), float(b.mean())
    norm_sum = mean_r + mean_g + mean_b + EPS
    exg = float(2 * mean_g - mean_r - mean_b)
    exr = float(1.4 * mean_r - mean_g)
    return {
        "mean_r": mean_r,
        "mean_g": mean_g,
        "mean_b": mean_b,
        "normalized_r": mean_r / norm_sum,
        "normalized_g": mean_g / norm_sum,
        "normalized_b": mean_b / norm_sum,
        "ExG": exg,
        "ExR": exr,
        "GLI": float((2 * mean_g - mean_r - mean_b) / (2 * mean_g + mean_r + mean_b + EPS)),
        "NGRDI": float((mean_g - mean_r) / (mean_g + mean_r + EPS)),
        "VARI": float((mean_g - mean_r) / (mean_g + mean_r - mean_b + EPS)),
        "RednessIndex": float(mean_r / (norm_sum)),
        "YellowingIndex": float(((mean_r + mean_g) / 2) - mean_b),
        "ColorHeterogeneity": float(np.mean([r.var(), g.var(), b.var()])),
    }


def _clamp01(v: float) -> float:
    return float(np.clip(v, 0.0, 1.0))


def compute_stress_score(baseline: dict, current: dict, growth_slowdown: float = 0.0) -> dict:
    green_loss = _clamp01((baseline["normalized_g"] - current["normalized_g"]) / (baseline["normalized_g"] + EPS))
    redness_inc = _clamp01((current["RednessIndex"] - baseline["RednessIndex"]) / (abs(baseline["RednessIndex"]) + EPS))
    yellow_inc = _clamp01((current["YellowingIndex"] - baseline["YellowingIndex"]) / (abs(baseline["YellowingIndex"]) + 10 + EPS))
    hetero_inc = _clamp01((current["ColorHeterogeneity"] - baseline["ColorHeterogeneity"]) / (baseline["ColorHeterogeneity"] + EPS))
    growth = _clamp01(growth_slowdown)

    score01 = 0.35 * green_loss + 0.25 * redness_inc + 0.20 * yellow_inc + 0.10 * growth + 0.10 * hetero_inc
    score = round(score01 * 100, 2)
    if score <= 30:
        cls = "Normal"
    elif score <= 60:
        cls = "İzlenmeli"
    elif score <= 80:
        cls = "Erken stres olasılığı"
    else:
        cls = "Yüksek stres olasılığı"

    return {
        "StressScore": score,
        "StressClass": cls,
        "components": {
            "GreenLoss": green_loss,
            "RednessIncrease": redness_inc,
            "YellowingIncrease": yellow_inc,
            "GrowthSlowdown": growth,
            "ColorHeterogeneityIncrease": hetero_inc,
        },
    }
