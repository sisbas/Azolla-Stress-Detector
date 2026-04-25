# Azolla Python Backend

Azolla görüntü işleme ve stres analizi için Python backend modülü.

## Algoritma Akışı

```
Görüntü alma
    ↓
HSV dönüşümü
    ↓
Threshold ile Azolla'yı ayır
    ↓
Alan + G/R oranı hesapla
    ↓
Erken stres göstergesi algoritmalarını uygula
```

## Kurulum

```bash
pip install opencv-python-headless numpy
```

## Kullanım

### Temel Kullanım

```python
import cv2
from azolla_analyzer import AzollaPipeline

# Pipeline'ı başlat
pipeline = AzollaPipeline()

# Görüntüyü yükle (BGR formatında)
image = cv2.imread('azolla_image.jpg')

# Analiz et
result = pipeline.process(image)

# Sonuçları al
print(f"Stres Seviyesi: {result.stress_level.value}")
print(f"Stres Skoru: {result.stress_score:.4f}")
print(f"Coverage Ratio: {result.segmentation.coverage_ratio:.4f}")

if result.features:
    print(f"G/R Oranı: {result.features.rg_ratio:.4f}")
    print(f"G Norm: {result.features.g_norm:.4f}")
```

### API Endpoint Örneği (FastAPI)

```python
from fastapi import FastAPI, File, UploadFile
from azolla_analyzer import AzollaPipeline
import cv2
import numpy as np

app = FastAPI()
pipeline = AzollaPipeline()

@app.post("/analyze")
async def analyze_azolla(file: UploadFile = File(...)):
    # Görüntüyü oku
    contents = await file.read()
    image = cv2.imdecode(np.frombuffer(contents, np.uint8), cv2.IMREAD_COLOR)
    
    # Analiz et
    result = pipeline.process(image)
    
    return {
        "stress_level": result.stress_level.value,
        "stress_score": result.stress_score,
        "coverage_ratio": result.segmentation.coverage_ratio,
        "glare_pct": result.glare_pct,
        "features": {
            "rg_ratio": result.features.rg_ratio if result.features else None,
            "g_norm": result.features.g_norm if result.features else None,
            "mean_r": result.features.mean_r if result.features else None,
            "mean_g": result.features.mean_g if result.features else None,
        } if result.features else None
    }
```

## Sınıf Yapısı

### AzollaPipeline

Ana işleme sınıfı. Tüm algoritma adımlarını içerir.

#### Metotlar

- `__init__(baseline_stats)`: Pipeline'ı başlat
- `process(image, timestamp)`: Ana işleme pipeline'ı

#### Özellikler

- `baseline_stats`: Sağlıklı Azolla için baseline istatistikler
- `hsv_lower`: HSV alt threshold değeri
- `hsv_upper`: HSV üst threshold değeri

### AnalysisResult

Analiz sonuçlarını içeren dataclass.

#### Alanlar

- `glare_pct`: Glare (parlama) yüzdesi
- `segmentation`: Segmentasyon kalite kontrol bilgisi
- `features`: Çıkarılan özellikler
- `metadata`: Görüntü metadata'sı
- `stress_level`: Stres seviyesi (enum)
- `stress_score`: Stres skoru (0-1 arası)
- `processed_image`: İşlenmiş görüntü
- `mask_image`: Segmentasyon maskesi
- `hsv_image`: HSV dönüştürülmüş görüntü

### StressLevel

Stres seviyesi enum'u.

- `NORMAL`: Normal (< 0.2)
- `LOW`: Düşük stres (0.2 - 0.4)
- `MEDIUM`: Orta stres (0.4 - 0.6)
- `HIGH`: Yüksek stres (0.6 - 0.8)
- `CRITICAL`: Kritik stres (> 0.8)

## Erken Stres Göstergeleri

Algoritma şu göstergeleri kullanır:

1. **G/R Oranı Sapması**: Kloroz belirtisi olarak kırmızı/yeşil oranındaki değişim
2. **G Norm Değeri**: Yeşil kanal normalizasyon değerindeki azalma
3. **Skewness Değişimi**: Yaprak yapısı bozulması
4. **Coverage Azalması**: Kaplama alanındaki düşüş
5. **RGRI**: Red-Green Ratio Index

## Test

```bash
python azolla_analyzer.py
```

## Lisans

MIT
