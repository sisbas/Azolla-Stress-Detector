from __future__ import annotations

import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ExifTags
from scipy import ndimage
from skimage import measure, morphology


def load_image(path: str | Path) -> np.ndarray:
    image = cv2.imread(str(path))
    if image is None:
        raise ValueError(f"Image could not be read: {path}")
    return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)


def read_exif_date(path: str | Path) -> date | None:
    try:
        img = Image.open(path)
        exif = img.getexif()
        if not exif:
            return None
        exif_map = {ExifTags.TAGS.get(tag, tag): value for tag, value in exif.items()}
        for key in ("DateTimeOriginal", "DateTime", "DateTimeDigitized"):
            if key in exif_map:
                return datetime.strptime(str(exif_map[key]), "%Y:%m:%d %H:%M:%S").date()
    except Exception:
        return None
    return None


def parse_date_from_filename(filename: str) -> date | None:
    patterns = [r"(\d{4})[-_](\d{2})[-_](\d{2})", r"(\d{8})"]
    for pat in patterns:
        m = re.search(pat, filename)
        if not m:
            continue
        try:
            if len(m.groups()) == 3:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            token = m.group(1)
            return datetime.strptime(token, "%Y%m%d").date()
        except ValueError:
            continue
    return None


def normalize_rgb(image: np.ndarray) -> np.ndarray:
    image = image.astype(np.float32)
    sums = image.sum(axis=2, keepdims=True) + 1e-6
    return image / sums


def compute_exg(image: np.ndarray) -> np.ndarray:
    n = normalize_rgb(image)
    return 2 * n[:, :, 1] - n[:, :, 0] - n[:, :, 2]


def compute_exr(image: np.ndarray) -> np.ndarray:
    n = normalize_rgb(image)
    return 1.4 * n[:, :, 0] - n[:, :, 1]


def create_green_mask(image: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(image, cv2.COLOR_RGB2HSV)
    exg = compute_exg(image)
    hsv_mask = cv2.inRange(hsv, (25, 25, 25), (95, 255, 255)) > 0
    exg_mask = exg > np.percentile(exg, 55)
    return np.logical_or(hsv_mask, exg_mask)


def create_red_stress_mask(image: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(image, cv2.COLOR_RGB2HSV)
    lab = cv2.cvtColor(image, cv2.COLOR_RGB2LAB)
    exr = compute_exr(image)
    red_hsv = np.logical_or(
        cv2.inRange(hsv, (0, 20, 20), (20, 255, 255)) > 0,
        cv2.inRange(hsv, (160, 20, 20), (179, 255, 255)) > 0,
    )
    brownish = cv2.inRange(lab, (20, 130, 110), (230, 190, 170)) > 0
    return np.logical_and(np.logical_or(red_hsv, brownish), exr > np.percentile(exr, 45))


def combine_masks(green_mask: np.ndarray, red_mask: np.ndarray) -> np.ndarray:
    return np.logical_or(green_mask, red_mask)


def clean_mask(mask: np.ndarray) -> np.ndarray:
    mask_u8 = (mask > 0).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    opened = cv2.morphologyEx(mask_u8, cv2.MORPH_OPEN, kernel, iterations=1)
    closed = cv2.morphologyEx(opened, cv2.MORPH_CLOSE, kernel, iterations=2)
    return closed > 0


def remove_small_components(mask: np.ndarray, min_size: int = 250) -> np.ndarray:
    return morphology.remove_small_objects(mask.astype(bool), min_size=min_size)


def fill_holes(mask: np.ndarray) -> np.ndarray:
    return ndimage.binary_fill_holes(mask).astype(bool)


def keep_largest_component(mask: np.ndarray) -> np.ndarray:
    labels = measure.label(mask, connectivity=2)
    if labels.max() == 0:
        return mask
    regions = measure.regionprops(labels)
    largest = max(regions, key=lambda x: x.area)
    return labels == largest.label


def extract_roi(mask: np.ndarray) -> dict[str, int]:
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return {"x": 0, "y": 0, "width": 0, "height": 0}
    x_min, x_max = int(xs.min()), int(xs.max())
    y_min, y_max = int(ys.min()), int(ys.max())
    return {"x": x_min, "y": y_min, "width": x_max - x_min + 1, "height": y_max - y_min + 1}


def apply_mask(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    out = np.zeros_like(image)
    out[mask] = image[mask]
    return out


def save_mask_and_segmented_image(
    image: np.ndarray,
    mask: np.ndarray,
    output_dir: str | Path,
    stem: str,
) -> tuple[str, str]:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    mask_path = output_dir / f"{stem}_mask.png"
    segmented_path = output_dir / f"{stem}_segmented.png"
    cv2.imwrite(str(mask_path), ((mask > 0).astype(np.uint8) * 255))
    cv2.imwrite(str(segmented_path), cv2.cvtColor(apply_mask(image, mask), cv2.COLOR_RGB2BGR))
    return str(mask_path), str(segmented_path)


def segment_azolla(image_path: str | Path, output_dir: str | Path) -> dict[str, Any]:
    image = load_image(image_path)
    green = create_green_mask(image)
    red = create_red_stress_mask(image)
    mask = combine_masks(green, red)
    mask = clean_mask(mask)
    mask = remove_small_components(mask)
    mask = fill_holes(mask)
    mask = keep_largest_component(mask)
    roi = extract_roi(mask)
    stem = Path(image_path).stem
    mask_path, segmented_path = save_mask_and_segmented_image(image, mask, output_dir, stem)
    return {
        "mask_path": mask_path,
        "segmented_image_path": segmented_path,
        "roi": roi,
        "plant_area_px": int(mask.sum()),
    }


def roi_to_json(roi: dict[str, int]) -> str:
    return json.dumps(roi)
