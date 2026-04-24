from __future__ import annotations

import cv2
import numpy as np


def evaluate_quality(image: np.ndarray, mask: np.ndarray, capture_date_exists: bool, scale_exists: bool) -> list[str]:
    flags: list[str] = []
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    brightness = float(gray.mean())
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    mask_ratio = float((mask > 0).sum() / mask.size)

    if brightness < 45:
        flags.append("Görsel çok karanlık")
    if brightness > 220:
        flags.append("Görsel aşırı parlak")
    if lap_var < 60:
        flags.append("Görsel bulanık")
    if mask_ratio < 0.01:
        flags.append("Segmentasyon alanı çok küçük")
    if cv2.connectedComponents((mask > 0).astype(np.uint8))[0] > 100:
        flags.append("Maskede çok fazla küçük obje var")
    if not capture_date_exists:
        flags.append("Tarih bilgisi eksik")
    if not scale_exists:
        flags.append("Ölçek bilgisi eksik")
    if mask_ratio < 0.03:
        flags.append("Stres skoru güvenilirliği düşük")

    return flags
