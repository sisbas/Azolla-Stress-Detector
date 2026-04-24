# Azolla RGB Growth & Stress Analyzer

Azolla bitkisi için RGB fotoğraflardan **segmentasyon, alan-bazlı büyüme, erken stres göstergeleri ve zaman serisi analizleri** üreten araştırma prototipi.

> ⚠️ **Bilimsel not:** RGB görüntüler doğrudan klorofil, biyokütle veya stres ölçmez. Bu sistem yalnızca görüntü tabanlı dolaylı göstergeler üretir. Gerçek biyokütle tahmini için taze ağırlık ölçümleriyle kalibrasyon gerekir.

## Proje çıktıları
- `backend/` — FastAPI + OpenCV + SQLAlchemy servisleri
- `frontend/` — React + TypeScript + Vite + Tailwind + Recharts + Konva tabanlı arayüz
- `requirements.txt`
- `docker-compose.yml`
- `.env.example`
- `docs/API.md`

## Backend mimarisi

### Servis modülleri
- `app/services/segmentation.py`
  - `load_image`, `read_exif_date`, `normalize_rgb`, `compute_exg`, `compute_exr`
  - `create_green_mask`, `create_red_stress_mask`, `combine_masks`
  - `clean_mask`, `remove_small_components`, `fill_holes`, `extract_roi`
  - `apply_mask`, `save_mask_and_segmented_image`
- `app/services/growth.py`
  - `calculate_plant_area`, `calculate_coverage_ratio`, `compare_two_images`, `calculate_area_based_rgr`
- `app/services/stress.py`
  - RGB indeksleri + baseline bazlı StressScore (0-100)
- `app/services/timeline.py`
  - sıralama, büyüme/stres timeline üretimi, anomaly tespiti
- `app/services/calibration.py`
  - Linear Regression + Random Forest Regression

### Segmentasyon akışı
1. RGB görsel okunur.
2. HSV/Lab dönüşümleri kullanılır.
3. Yeşil maske (HSV + ExG) üretilir.
4. Stresli kırmızı-kahverengi maske (HSV + Lab + ExR) üretilir.
5. Maskeler birleştirilir.
6. Opening/closing uygulanır.
7. Küçük bileşenler temizlenir.
8. Boşluklar doldurulur.
9. En büyük component seçilir.
10. Maske, izole görüntü, ROI ve alan üretilir.

### API endpointleri
- `POST /api/experiments`
- `POST /api/experiments/{id}/images`
- `POST /api/images/{id}/analyze`
- `PUT /api/images/{id}/mask`
- `GET /api/experiments/{id}/timeline`
- `POST /api/experiments/{id}/compare`
- `POST /api/experiments/{id}/calibration-data`
- `POST /api/experiments/{id}/train-biomass-model`
- `GET /api/experiments/{id}/export`

## Frontend ekranları
1. Deney oluşturma
2. Görsel yükleme
3. Segmentasyon sonucu
4. Manuel maske/ROI düzeltme
5. İki görsel karşılaştırma
6. Zaman serisi dashboard
7. Kalibrasyon verisi girişi
8. CSV dışa aktarım

## Kalite kontrol uyarıları
- Görsel çok karanlık
- Görsel aşırı parlak
- Görsel bulanık
- Segmentasyon alanı çok küçük
- Maskede çok fazla küçük obje var
- Tarih bilgisi eksik
- Ölçek bilgisi eksik
- Stres skoru güvenilirliği düşük

## Kurulum ve çalıştırma

### 1) Ortam değişkenleri
```bash
cp .env.example .env
```

### 2) Backend (yerel)
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd backend
uvicorn app.main:app --reload --port 8000
```

### 3) Frontend (yerel)
```bash
cd frontend
npm install
npm run dev
```

### 4) Docker ile
```bash
docker compose up --build
```

## Frond sayımı (ileri faz)
V1 kapsamına dahil edilmedi; deneysel modül olarak planlanmıştır.
Önerilen yaklaşım: distance transform + watershed + manuel doğrulama; gerektiğinde YOLO/Mask R-CNN/U-Net.
