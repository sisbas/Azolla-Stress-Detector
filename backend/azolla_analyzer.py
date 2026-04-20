"""
Azolla Stres Analizi Python Backend

Bu modül, Azolla görüntülerini işleyerek erken stres göstergelerini tespit eder.
Algoritma akışı:
    1. Görüntü alma
    2. HSV dönüşümü
    3. Threshold ile Azolla'yı ayır
    4. Alan + G/R oranı hesapla
    5. Erken stres göstergesi algoritmalarını uygula
"""

import cv2
import numpy as np
from typing import Dict, Tuple, Optional, Any
from dataclasses import dataclass
from enum import Enum


class StressLevel(Enum):
    """Stres seviyesi sınıflandırması"""
    NORMAL = "normal"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class SegmentationQC:
    """Segmentasyon kalite kontrol metrikleri"""
    coverage_ratio: float
    threshold_value: float
    boundary_roughness: float
    is_valid: bool
    status: str = "ok"


@dataclass
class FeatureRecord:
    """Özellik kaydı"""
    timestamp: int
    coverage: float
    mean_r: float
    mean_g: float
    mean_b: float
    r_norm: float
    g_norm: float
    rg_ratio: float
    rgri: float
    skew_g: float
    kurt_g: float
    area_pixels: int


@dataclass
class AnalysisResult:
    """Analiz sonucu"""
    glare_pct: float
    segmentation: Optional[SegmentationQC]
    features: Optional[FeatureRecord]
    metadata: Dict[str, Any]
    stress_level: StressLevel
    stress_score: float
    processed_image: Optional[np.ndarray] = None
    mask_image: Optional[np.ndarray] = None
    hsv_image: Optional[np.ndarray] = None


class AzollaPipeline:
    """
    Azolla görüntü işleme ve stres analizi pipeline'ı
    
    Algoritma adımları:
    1. Görüntü alma ve ön işleme
    2. HSV renk uzayına dönüşüm
    3. Threshold ile Azolla segmentasyonu
    4. Alan ve G/R oranı hesaplama
    5. Erken stres göstergesi algoritmaları
    """
    
    def __init__(self, baseline_stats: Optional[Dict[str, Dict[str, float]]] = None):
        """
        Pipeline'ı başlat
        
        Args:
            baseline_stats: Baseline istatistikler (rg_ratio, g_norm, vb.)
        """
        # Baseline değerler (normal sağlıklı Azolla için)
        self.baseline_stats = baseline_stats or {
            'rg_ratio': {'mean': 0.42, 'std': 0.05},
            'g_norm': {'mean': 0.38, 'std': 0.04},
            'exg': {'mean': 0.15, 'std': 0.03},
            'texture_local': {'mean': 0.2, 'std': 0.05}
        }
        
        # HSV threshold değerleri (Azolla yeşili için optimize edilmiş)
        self.hsv_lower = np.array([35, 40, 40])
        self.hsv_upper = np.array([70, 255, 255])
        
        # Glare threshold
        self.glare_threshold = 242
    
    def _compute_exg(self, image: np.ndarray) -> np.ndarray:
        """
        Excess Green Index (ExG) hesapla
        exg = (2.0 * G - R - B)
        
        Args:
            image: BGR formatında görüntü
            
        Returns:
            Normalize edilmiş ExG matrisi
        """
        b, g, r = cv2.split(image)
        exg = 2.0 * g.astype(np.float32) - r.astype(np.float32) - b.astype(np.float32)
        
        # Normalize to [0, 1]
        min_val, max_val = exg.min(), exg.max()
        range_val = max_val - min_val + 1e-8
        exg_normalized = (exg - min_val) / range_val
        
        return exg_normalized
    
    def _otsu_threshold(self, data: np.ndarray, lower: float, upper: float) -> float:
        """
        Otsu's thresholding algoritması (bounded)
        
        Args:
            data: Veri matrisi
            lower: Alt sınır
            upper: Üst sınır
            
        Returns:
            Threshold değeri
        """
        # Sınırlar içindeki verileri filtrele
        mask = (data >= lower) & (data <= upper)
        filtered_data = data[mask]
        
        if len(filtered_data) == 0:
            return 0.5
        
        # Histogram oluştur
        hist, _ = np.histogram(filtered_data, bins=256, range=(0, 1))
        
        if hist.sum() == 0:
            return 0.5
        
        # Otsu's method
        total = hist.sum()
        sum_total = np.sum(np.arange(256) * hist)
        
        sum_front = 0
        weight_front = 0
        weight_back = 0
        max_var = 0
        threshold = 0
        
        for i in range(256):
            weight_front += hist[i]
            if weight_front == 0:
                continue
            
            weight_back = total - weight_front
            if weight_back == 0:
                break
            
            sum_front += i * hist[i]
            mean_front = sum_front / weight_front
            mean_back = (sum_total - sum_front) / weight_back
            
            var_between = weight_front * weight_back * (mean_front - mean_back) ** 2
            
            if var_between > max_var:
                max_var = var_between
                threshold = i
        
        return threshold / 255.0
    
    def _calculate_moments(self, data: np.ndarray) -> Tuple[float, float]:
        """
        Skewness ve Kurtosis hesapla
        
        Args:
            data: Veri dizisi
            
        Returns:
            (skewness, kurtosis) tuple
        """
        if len(data) < 2:
            return 0.0, 0.0
        
        n = len(data)
        mean = np.mean(data)
        std = np.std(data)
        
        if std == 0:
            return 0.0, 0.0
        
        # Skewness
        skew = np.mean(((data - mean) / std) ** 3)
        
        # Kurtosis
        kurt = np.mean(((data - mean) / std) ** 4) - 3
        
        return skew, kurt
    
    def _detect_glare(self, image: np.ndarray) -> Tuple[float, np.ndarray]:
        """
        Görüntüdeki glare (parlama) bölgelerini tespit et
        
        Args:
            image: BGR görüntü
            
        Returns:
            (glare_percentage, glare_mask)
        """
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        glare_mask = (gray > self.glare_threshold).astype(np.uint8)
        glare_pct = (np.sum(glare_mask) / glare_mask.size) * 100
        
        return glare_pct, glare_mask
    
    def _segment_azolla_hsv(self, hsv_image: np.ndarray, glare_mask: np.ndarray) -> Tuple[np.ndarray, float]:
        """
        HSV renk uzayında Azolla segmentasyonu
        
        Args:
            hsv_image: HSV formatında görüntü
            glare_mask: Glare maskesi
            
        Returns:
            (mask, coverage_ratio)
        """
        # HSV threshold ile maske oluştur
        mask = cv2.inRange(hsv_image, self.hsv_lower, self.hsv_upper)
        
        # Glare bölgelerini maskeden çıkar
        mask = cv2.bitwise_and(mask, mask, mask=255 - glare_mask)
        
        # Morfolojik işlemler (noise temizleme)
        kernel = np.ones((5, 5), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        
        # Coverage ratio hesapla
        coverage_ratio = np.sum(mask > 0) / mask.size
        
        return mask, coverage_ratio
    
    def _extract_features(self, image: np.ndarray, mask: np.ndarray, 
                         timestamp: int) -> FeatureRecord:
        """
        Segmentlenmiş Azolla bölgesinden özellikler çıkar
        
        Args:
            image: BGR görüntü
            mask: Segmentasyon maskesi
            timestamp: Zaman damgası
            
        Returns:
            FeatureRecord
        """
        # Maskeli bölgelerdeki piksel değerlerini al
        masked_pixels = image[mask > 0]
        
        if len(masked_pixels) == 0:
            return FeatureRecord(
                timestamp=timestamp,
                coverage=0.0,
                mean_r=0.0,
                mean_g=0.0,
                mean_b=0.0,
                r_norm=0.0,
                g_norm=0.0,
                rg_ratio=0.0,
                rgri=0.0,
                skew_g=0.0,
                kurt_g=0.0,
                area_pixels=0
            )
        
        # Reshape to get individual pixels
        masked_pixels = masked_pixels.reshape(-1, 3)
        
        b_vals = masked_pixels[:, 0].astype(np.float32)
        g_vals = masked_pixels[:, 1].astype(np.float32)
        r_vals = masked_pixels[:, 2].astype(np.float32)
        
        # Ortalamalar
        mean_r = np.mean(r_vals)
        mean_g = np.mean(g_vals)
        mean_b = np.mean(b_vals)
        
        # Normalizasyon
        s = mean_r + mean_g + mean_b + 1e-8
        r_norm = mean_r / s
        g_norm = mean_g / s
        
        # G/R oranı
        rg_ratio = mean_r / (mean_g + 1e-8)
        
        # RGRI (Red-Green Ratio Index)
        rgri = (mean_r - mean_g) / (mean_r + mean_g + 1e-8)
        
        # Momentler (G kanalı için)
        skew_g, kurt_g = self._calculate_moments(g_vals)
        
        # Coverage
        coverage = np.sum(mask > 0) / mask.size
        
        return FeatureRecord(
            timestamp=timestamp,
            coverage=coverage,
            mean_r=mean_r,
            mean_g=mean_g,
            mean_b=mean_b,
            r_norm=r_norm,
            g_norm=g_norm,
            rg_ratio=rg_ratio,
            rgri=rgri,
            skew_g=skew_g,
            kurt_g=kurt_g,
            area_pixels=len(masked_pixels)
        )
    
    def _calculate_stress_score(self, features: FeatureRecord) -> Tuple[float, StressLevel]:
        """
        Erken stres göstergesi algoritmalarını uygula
        
        Stres kriterleri:
        1. G/R oranı artışı (kloroz belirtisi)
        2. G norm değerinde azalma
        3. Skewness değişimi (yaprak yapısı bozulması)
        4. Coverage azalması
        
        Args:
            features: Özellik kaydı
            
        Returns:
            (stress_score, stress_level)
        """
        score = 0.0
        
        # 1. G/R oranı kontrolü (baseline'a göre sapma)
        bl_rg = self.baseline_stats['rg_ratio']
        rg_deviation = abs(features.rg_ratio - bl_rg['mean']) / bl_rg['std']
        if rg_deviation > 2.0:
            score += min(rg_deviation / 5.0, 1.0) * 0.3
        
        # 2. G norm kontrolü
        bl_g = self.baseline_stats['g_norm']
        g_deviation = abs(features.g_norm - bl_g['mean']) / bl_g['std']
        if g_deviation > 2.0:
            score += min(g_deviation / 5.0, 1.0) * 0.25
        
        # 3. Skewness kontrolü (yaprak yapısı bozulması)
        if abs(features.skew_g) > 1.5:
            score += min(abs(features.skew_g) / 3.0, 1.0) * 0.2
        
        # 4. Coverage kontrolü
        if features.coverage < 0.05:
            score += 0.25
        
        # 5. RGRI kontrolü
        if features.rgri > 0.1:
            score += min(features.rgri * 2, 1.0) * 0.15
        
        # Score'u normalize et
        score = min(score, 1.0)
        
        # Stres seviyesini belirle
        if score < 0.2:
            level = StressLevel.NORMAL
        elif score < 0.4:
            level = StressLevel.LOW
        elif score < 0.6:
            level = StressLevel.MEDIUM
        elif score < 0.8:
            level = StressLevel.HIGH
        else:
            level = StressLevel.CRITICAL
        
        return score, level
    
    def process(self, image: np.ndarray, timestamp: Optional[int] = None) -> AnalysisResult:
        """
        Ana işleme pipeline'ı
        
        Adımlar:
        1. Görüntü alma
        2. HSV dönüşümü
        3. Threshold ile Azolla'yı ayır
        4. Alan + G/R oranı hesapla
        5. Erken stres göstergesi algoritmalarını uygula
        
        Args:
            image: BGR formatında giriş görüntüsü (OpenCV formatı)
            timestamp: İsteğe bağlı zaman damgası
            
        Returns:
            AnalysisResult
        """
        if timestamp is None:
            timestamp = int(cv2.getTickCount())
        
        # 1. Görüntü alma - boyutları kaydet
        height, width = image.shape[:2]
        metadata = {
            'width': width,
            'height': height,
            'channels': 3
        }
        
        # 2. HSV dönüşümü
        hsv_image = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        
        # Glare tespiti
        glare_pct, glare_mask = self._detect_glare(image)
        
        # 3. Threshold ile Azolla'yı ayır
        mask, coverage_ratio = self._segment_azolla_hsv(hsv_image, glare_mask)
        
        # Segmentasyon kalite kontrol
        is_valid = coverage_ratio > 0.01 and glare_pct < 8.0
        segmentation = SegmentationQC(
            coverage_ratio=coverage_ratio,
            threshold_value=0.5,  # HSV threshold ortalaması
            boundary_roughness=1.2,
            is_valid=is_valid,
            status="ok" if is_valid else "invalid"
        )
        
        # 4. Alan + G/R oranı hesapla
        features = None
        stress_score = 0.0
        stress_level = StressLevel.NORMAL
        
        if segmentation.is_valid and np.sum(mask > 0) > 50:
            features = self._extract_features(image, mask, timestamp)
            
            # 5. Erken stres göstergesi algoritmalarını uygula
            stress_score, stress_level = self._calculate_stress_score(features)
        
        # Görselleştirme için maskeleri hazırla
        mask_bgr = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
        processed_image = cv2.addWeighted(image, 0.7, mask_bgr, 0.3, 0)
        
        return AnalysisResult(
            glare_pct=glare_pct,
            segmentation=segmentation,
            features=features,
            metadata=metadata,
            stress_level=stress_level,
            stress_score=stress_score,
            processed_image=processed_image,
            mask_image=mask,
            hsv_image=hsv_image
        )


def main():
    """Örnek kullanım"""
    # Test için örnek görüntü oluştur
    test_image = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)
    
    # Pipeline'ı başlat
    pipeline = AzollaPipeline()
    
    # Görüntüyü işle
    result = pipeline.process(test_image)
    
    # Sonuçları yazdır
    print(f"Glare Percentage: {result.glare_pct:.2f}%")
    print(f"Segmentation Valid: {result.segmentation.is_valid}")
    print(f"Coverage Ratio: {result.segmentation.coverage_ratio:.4f}")
    
    if result.features:
        print(f"\nFeatures:")
        print(f"  Mean R: {result.features.mean_r:.2f}")
        print(f"  Mean G: {result.features.mean_g:.2f}")
        print(f"  Mean B: {result.features.mean_b:.2f}")
        print(f"  G/R Ratio: {result.features.rg_ratio:.4f}")
        print(f"  G Norm: {result.features.g_norm:.4f}")
        print(f"  Skewness G: {result.features.skew_g:.4f}")
    
    print(f"\nStress Analysis:")
    print(f"  Stress Score: {result.stress_score:.4f}")
    print(f"  Stress Level: {result.stress_level.value}")


if __name__ == "__main__":
    main()
