import { useMemo, useState } from 'react';
import {
  addCalibrationData,
  analyzeImage,
  compareImages,
  createExperiment,
  exportExperiment,
  getTimeline,
  trainBiomassModel,
  updateMask,
  uploadImage,
} from './api/endpoints';
import { MaskEditor } from './components/MaskEditor';
import { TimelineCharts } from './components/TimelineCharts';

export default function App() {
  const [experimentId, setExperimentId] = useState<number | null>(null);
  const [imageId, setImageId] = useState<number | null>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [compareIds, setCompareIds] = useState({ t1: '', t2: '' });
  const [log, setLog] = useState('Hazır.');

  const screens = useMemo(
    () => [
      '1. Deney oluşturma',
      '2. Görsel yükleme',
      '3. Segmentasyon sonucu',
      '4. Manuel maske/ROI düzeltme',
      '5. İki görsel karşılaştırma',
      '6. Zaman serisi dashboard',
      '7. Kalibrasyon verisi girişi',
      '8. CSV/Excel dışa aktarım',
    ],
    [],
  );

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <h1 className="mb-2 text-3xl font-bold">Azolla RGB Growth & Stress Analyzer</h1>
      <p className="mb-6 text-sm text-amber-300">
        Bilimsel not: RGB göstergeler dolaylıdır; gerçek biyokütle tahmini için taze ağırlık kalibrasyonu gerekir.
      </p>

      <section className="mb-6 rounded border border-slate-700 p-4">
        <h2 className="mb-2 text-xl font-semibold">Ekranlar</h2>
        <ul className="grid gap-1 text-sm md:grid-cols-2">{screens.map((s) => <li key={s}>{s}</li>)}</ul>
      </section>

      <section className="mb-6 grid gap-4 rounded border border-slate-700 p-4 md:grid-cols-2">
        <button
          className="rounded bg-emerald-600 px-3 py-2"
          onClick={async () => {
            const res = await createExperiment('Deney', 'Azolla prototip deneyi');
            setExperimentId(res.data.id);
            setLog(`Experiment created: ${res.data.id}`);
          }}
        >
          Deney Oluştur
        </button>

        <input
          type="file"
          onChange={async (e) => {
            if (!experimentId || !e.target.files?.[0]) return;
            const res = await uploadImage(experimentId, e.target.files[0]);
            setImageId(res.data.id);
            setLog(`Image uploaded: ${res.data.id}`);
          }}
        />

        <button
          className="rounded bg-cyan-600 px-3 py-2"
          onClick={async () => {
            if (!imageId) return;
            const res = await analyzeImage(imageId);
            setLog(JSON.stringify(res.data, null, 2));
          }}
        >
          Görseli Analiz Et
        </button>

        <button
          className="rounded bg-indigo-600 px-3 py-2"
          onClick={async () => {
            if (!experimentId) return;
            const res = await getTimeline(experimentId);
            setTimeline(
              (res.data.growth || []).map((g: any, i: number) => ({
                ...g,
                ...(res.data.stress?.[i] ?? {}),
              })),
            );
            setLog('Timeline yüklendi.');
          }}
        >
          Timeline Getir
        </button>
      </section>

      <section className="mb-6 rounded border border-slate-700 p-4">
        <h2 className="mb-2 text-xl font-semibold">Manuel ROI / Maske</h2>
        <MaskEditor
          onSave={async (roi) => {
            if (!imageId) return;
            await updateMask(imageId, { roi });
            setLog('ROI güncellendi.');
          }}
        />
      </section>

      <section className="mb-6 rounded border border-slate-700 p-4">
        <h2 className="mb-2 text-xl font-semibold">İki Görsel Karşılaştırma</h2>
        <div className="flex gap-2">
          <input className="bg-slate-800 p-2" placeholder="image t1" value={compareIds.t1} onChange={(e) => setCompareIds((p) => ({ ...p, t1: e.target.value }))} />
          <input className="bg-slate-800 p-2" placeholder="image t2" value={compareIds.t2} onChange={(e) => setCompareIds((p) => ({ ...p, t2: e.target.value }))} />
          <button
            className="rounded bg-orange-600 px-3 py-2"
            onClick={async () => {
              if (!experimentId) return;
              const res = await compareImages(experimentId, Number(compareIds.t1), Number(compareIds.t2));
              setLog(JSON.stringify(res.data, null, 2));
            }}
          >
            Karşılaştır
          </button>
        </div>
      </section>

      <section className="mb-6 rounded border border-slate-700 p-4">
        <h2 className="mb-2 text-xl font-semibold">Zaman Serisi Dashboard</h2>
        <TimelineCharts data={timeline} />
      </section>

      <section className="mb-6 grid gap-2 rounded border border-slate-700 p-4 md:grid-cols-3">
        <button
          className="rounded bg-purple-700 px-3 py-2"
          onClick={async () => {
            if (!experimentId) return;
            await addCalibrationData(experimentId, {
              fresh_weight_g: 3.2,
              plant_area_px: 12000,
              plant_area_cm2: 30.2,
              coverage_ratio: 0.78,
              mean_g: 110,
              gli: 0.22,
              exg: 0.12,
              redness_index: 0.31,
              color_heterogeneity: 44,
            });
            setLog('Kalibrasyon noktası eklendi.');
          }}
        >
          Kalibrasyon Verisi Ekle
        </button>
        <button
          className="rounded bg-fuchsia-700 px-3 py-2"
          onClick={async () => {
            if (!experimentId) return;
            const res = await trainBiomassModel(experimentId);
            setLog(JSON.stringify(res.data, null, 2));
          }}
        >
          Biyokütle Modeli Eğit
        </button>
        <button
          className="rounded bg-teal-700 px-3 py-2"
          onClick={async () => {
            if (!experimentId) return;
            const res = await exportExperiment(experimentId);
            setLog(JSON.stringify(res.data, null, 2));
          }}
        >
          CSV Dışa Aktar
        </button>
      </section>

      <pre className="overflow-auto rounded border border-slate-700 bg-slate-900 p-3 text-xs">{log}</pre>
    </main>
  );
}
