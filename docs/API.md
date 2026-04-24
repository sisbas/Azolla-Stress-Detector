# API Dokümantasyonu

Base URL: `http://localhost:8000/api`

## Endpointler
- `POST /experiments` — yeni deney oluşturur.
- `POST /experiments/{id}/images` — deneye görsel yükler.
- `POST /images/{id}/analyze` — segmentasyon + büyüme + stres analizi.
- `PUT /images/{id}/mask` — manuel ROI/maske düzeltmesi.
- `GET /experiments/{id}/timeline` — alan/stres zaman serisi.
- `POST /experiments/{id}/compare` — iki zaman noktası karşılaştırması.
- `POST /experiments/{id}/calibration-data` — taze ağırlık kalibrasyon noktası ekler.
- `POST /experiments/{id}/train-biomass-model` — linear/rf model eğitimi.
- `GET /experiments/{id}/export` — CSV dışa aktarım.

## Bilimsel Uyarı
RGB görüntüler doğrudan klorofil, biyokütle veya stres ölçmez; dolaylı indeksler üretir.
Gerçek biyokütle tahmini için taze ağırlık kalibrasyonu zorunludur.

## Frond Sayımı
V1'de aktif değildir; ileri faz/deneysel modül olarak planlanmıştır.
