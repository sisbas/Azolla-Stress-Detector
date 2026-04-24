from __future__ import annotations

import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

FEATURES = [
    "plant_area_px",
    "plant_area_cm2",
    "coverage_ratio",
    "mean_g",
    "GLI",
    "ExG",
    "RednessIndex",
    "ColorHeterogeneity",
]


def _as_matrix(records: list[dict]):
    x = np.array([[r[k] for k in FEATURES] for r in records], dtype=float)
    y = np.array([r["fresh_weight_g"] for r in records], dtype=float)
    return x, y


def train_biomass_models(records: list[dict]) -> dict:
    if len(records) < 5:
        raise ValueError("At least 5 calibration points are required.")
    x, y = _as_matrix(records)

    lin = LinearRegression().fit(x, y)
    rf = RandomForestRegressor(n_estimators=200, random_state=42).fit(x, y)

    pred_lin = lin.predict(x)
    pred_rf = rf.predict(x)

    def metrics(pred):
        return {
            "R2": float(r2_score(y, pred)),
            "RMSE": float(mean_squared_error(y, pred) ** 0.5),
            "MAE": float(mean_absolute_error(y, pred)),
        }

    m_lin, m_rf = metrics(pred_lin), metrics(pred_rf)
    best = "random_forest" if m_rf["R2"] >= m_lin["R2"] else "linear"
    return {
        "best_model": best,
        "linear_regression": m_lin,
        "random_forest": m_rf,
        "predicted_fresh_weight_g": float(pred_rf[-1] if best == "random_forest" else pred_lin[-1]),
    }
