# Azolla Erken Stres Tespit Sistemi (Azolla Stress Detection Pipeline)

Bu uygulama, Azolla bitkilerinde erken evre stres belirtilerini görüntü işleme ve istatistiksel analiz yöntemleriyle tespit etmek için geliştirilmiş uçtan uca (end-to-end) bir araştırma hattıdır. Akademik çalışmalar, tezler ve laboratuvar deneyleri için izlenebilir, tekrarlanabilir ve bilimsel geçerliliği olan veriler üretir.

## 🚀 Temel Özellikler

- **Gelişmiş Görüntü İşleme:** Sharp kütüphanesi kullanılarak standardizasyon, parlama maskeleme ve ExG (Excess Green) tabanlı segmentasyon.
- **Zaman Serisi Analizi:** Birden fazla zaman noktasından gelen verileri birleştirerek stres olasılığı hesaplama.
- **İstatistiksel Validasyon:** Cross-Validation, Bootstrap Güven Aralıkları ve Proxy Mixed-Effects Model (LME) analizi.
- **Akademik Raporlama:** Deney metadata'sı, CSV formatında karar kayıtları, denetim izleri (Audit Log) ve teze hazır LaTeX tablo çıktıları.
- **Modern Arayüz:** Recharts ile görselleştirme, Tailwind CSS ile şık ve karanlık tema (Sophisticated Dark).

## 🛠 Kurulum

### Gereksinimler
- Node.js (v18+)
- npm

### Adımlar
1. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```
2. Uygulamayı geliştirme modunda başlatın:
   ```bash
   npm run dev
   ```
3. Tarayıcınızda `http://localhost:3000` adresine gidin.


## 🤗 Hugging Face Spaces (Docker)

Bu repo, Docker tabanlı Hugging Face Space ortamında çalışacak şekilde ayarlanmıştır.

- Uygulama portu `PORT` environment variable üzerinden okunur (Space içinde varsayılan `7860`).
- Container başlangıcında üretim derlemesi (`npm run build`) hazırlanır ve `npm run start` ile servis ayağa kalkar.

### Önerilen Space ayarı
- **SDK:** Docker
- **App Port:** `7860`
- **Space Secrets / Variables:** Gerekli ise `.env` değişkenlerinizi buradan ekleyin (örn. API key).

## 📖 Kullanım

1. **Analiz:** "Görüntü Yükle" butonu ile Azolla bitkisinin fotoğrafını sisteme aktarın. Sistem otomatik olarak segmentasyon yapacak ve özellikleri çıkaracaktır.
2. **Trend Takibi:** Birden fazla görüntü yükledikçe "Trendler" sekmesinde stres olasılığının zamanla değişimini izleyin.
3. **Validasyon:** "Validasyon" sekmesine geçerek modelin istatistiksel güvenilirliğini kontrol edin.
4. **Raporlama:** "Nihai Rapor Oluştur" butonuna tıklayarak deney sonuçlarını sunucuya kaydedin ve LaTeX kodunu alın.

## 📡 API Referansı

Sunucu varsayılan olarak `3000` portunda çalışır. Tüm API istekleri `/api` ön ekiyle başlar.

### 1. Health Check
Sistemin ve aktif deneyin durumunu kontrol eder.

- **Endpoint:** `GET /api/health`
- **Yanıt:**
  ```json
  {
    "status": "ok",
    "timestamp": "2026-04-15T...",
    "experimentId": "exp_123456789"
  }
  ```

### 2. Görüntü Analizi
Yüklenen görüntüyü işler ve biyolojik özellikleri çıkarır.

- **Endpoint:** `POST /api/analyze`
- **İçerik Tipi:** `multipart/form-data`
- **Parametreler:** `image` (File)
- **Yanıt:** `AnalysisResult` objesi (Base64 işlenmiş görüntü, maske ve özellik kayıtları).

### 3. Rapor Oluşturma
Deney verilerini arşivler ve akademik rapor dosyalarını üretir.

- **Endpoint:** `POST /api/report`
- **İçerik Tipi:** `application/json`
- **Gövde (Body):**
  ```json
  {
    "decisions": [...],
    "validationData": { "cv": [...], "bootstrap": {...} },
    "figures": { "chart_name": "base64_data" }
  }
  ```
- **Yanıt:** Nihai rapor özeti ve LaTeX snippet'i.

## 📂 Dosya Yapısı (Sunucu Tarafı)

Raporlar `results/[experiment_id]/` dizini altında saklanır:
- `metadata.json`: Deneyin donanım ve yazılım konfigürasyonu.
- `audit_log.txt`: Pipeline adımlarının zaman damgalı kaydı.
- `final/decisions.csv`: Tüm kararların ham verisi.
- `final/rationale_log.txt`: Kararların mantıksal gerekçeleri.
- `performance_table.tex`: Teze hazır LaTeX tablosu.

## 🧪 Metodoloji

Pipeline şu aşamalardan oluşur:
1. **Standardizasyon:** Görüntü parlaklık ve kontrast kalibrasyonu.
2. **Segmentasyon:** ExG indeksi ve Otsu eşikleme ile bitki piksellerinin ayrılması.
3. **Özellik Çıkarımı:** Renk momentleri (Skewness, Kurtosis) ve doku analizi (GLCM Entropy).
4. **Karar:** Çok kriterli olasılık skorlama.
5. **Validasyon:** İstatistiksel doğrulama ve güven analizi.

---
*Bu proje Azolla bitkisi üzerine yapılan bilimsel araştırmaları desteklemek amacıyla geliştirilmiştir.*
