/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Camera, 
  Activity, 
  AlertTriangle, 
  ArrowDown, 
  CheckCircle2, 
  Layers, 
  Zap,
  Upload,
  RefreshCw,
  FileText,
  ShieldCheck,
  TrendingUp,
  BarChart3,
  History as HistoryIcon,
  Info,
  AlertCircle,
  X,
  Palette
} from "lucide-react";
import { EarlyStressDecider, DecisionRecord, FeatureRecord } from "./services/decider";
import { ValidationEngine, ValidationMetrics, BootstrapResult } from "./services/validation";
import { analyzeAzollaWithAI, AIAnalysisResult } from "./services/geminiService";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area
} from "recharts";

interface AnalysisData {
  glare_pct: number;
  segmentation?: {
    coverage_ratio: number;
    threshold_value: number;
    threshold_drift: number;
    boundary_roughness: number;
    glare_overlap_pct: number;
    is_valid: boolean;
  };
  features?: FeatureRecord;
  metadata: {
    width: number;
    height: number;
    channels: number;
  };
  processedImage: string;
  maskImage?: string;
  stressMap?: {
    overlay: string;
    pseudocolor: string;
    metrics: {
      stress_coverage_pct: number;
      mean_stress_score: number;
      max_stress_score: number;
    };
  };
}

const colormapLegends = {
  biological: [
    { color: "#2ecc71", label: "Normal" },
    { color: "#f1c40f", label: "Hafif" },
    { color: "#e67e22", label: "Orta" },
    { color: "#e74c3c", label: "Şiddetli" }
  ],
  viridis: [
    { color: "#440154", label: "Normal" },
    { color: "#21908d", label: "Düşük" },
    { color: "#5dc962", label: "Orta" },
    { color: "#fde725", label: "Şiddetli" }
  ],
  plasma: [
    { color: "#0d0887", label: "Normal" },
    { color: "#cc4778", label: "Düşük" },
    { color: "#f89540", label: "Orta" },
    { color: "#f0f921", label: "Şiddetli" }
  ],
  inferno: [
    { color: "#000004", label: "Normal" },
    { color: "#bb3754", label: "Düşük" },
    { color: "#f98e09", label: "Orta" },
    { color: "#fcffa4", label: "Şiddetli" }
  ]
};

export default function App() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisData | null>(null);
  const [history, setHistory] = useState<FeatureRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"original" | "mask" | "stress">("original");
  const [activeTab, setActiveTab] = useState<"analysis" | "trends" | "history" | "validation" | "ai">("analysis");
  const [isExporting, setIsExporting] = useState(false);
  const [isAIAnalyzing, setIsAIAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);
  const [finalReport, setFinalReport] = useState<any>(null);
  const [colormap, setColormap] = useState<"biological" | "viridis" | "plasma" | "inferno">("biological");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastFileRef = useRef<File | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement> | File) => {
    const file = e instanceof File ? e : e.target.files?.[0];
    if (!file) return;
    lastFileRef.current = file;

    setIsAnalyzing(true);
    setError(null);
    const formData = new FormData();
    formData.append("image", file);
    formData.append("colormap", colormap);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { 'Accept': 'application/json' },
        body: formData,
        credentials: "include",
      });
      
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        if (text.includes("Cookie check") || text.includes("Action required to load your app")) {
          setError("COOKIE_CHECK");
          return;
        }
        console.error("Non-JSON response received:", text);
        throw new Error(`Server returned non-JSON response (${response.status})`);
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Analysis failed");
      }

      const data = await response.json();
      setResult(data);
      if (data.features) {
        setHistory(prev => [...prev, data.features].sort((a, b) => a.timestamp - b.timestamp));
      }
      setViewMode("original");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Görüntü işleme sırasında bir hata oluştu.");
      console.error(err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAIAnalysis = async () => {
    if (!result || !result.features) return;
    setIsAIAnalyzing(true);
    try {
      const analysis = await analyzeAzollaWithAI(
        result.processedImage,
        result.features,
        history
      );
      setAiResult(analysis);
      setActiveTab("ai");
    } catch (err) {
      console.error(err);
      setError("Yapay zeka analizi sırasında bir hata oluştu.");
    } finally {
      setIsAIAnalyzing(false);
    }
  };

  const temporalAnalysis = useMemo(() => {
    if (history.length === 0) return null;
    const decider = new EarlyStressDecider();
    const decisions = decider.decide(history);
    return decisions[decisions.length - 1];
  }, [history]);

  const validationData = useMemo(() => {
    if (history.length < 3) return null;
    const engine = new ValidationEngine();
    const decider = new EarlyStressDecider();
    const decisions = decider.decide(history);
    return {
      decisions,
      cv: engine.crossValidate(history, 3),
      bootstrap: engine.bootstrapConfidence(history, 500),
      summary: engine.getStatisticalSummary(history)
    };
  }, [history]);

  const handleExport = async () => {
    if (!validationData) return;
    setIsExporting(true);
    try {
      // In a real scenario, we might use html2canvas to capture charts.
      // For this implementation, we'll simulate figure data.
      const simulatedFigures = {
        "stress_probability_trend": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", // 1x1 transparent pixel
        "coverage_vs_rg_ratio": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
      };

      const response = await fetch("/api/report", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({
          decisions: validationData.decisions,
          validationData: {
            cv: validationData.cv,
            bootstrap: validationData.bootstrap
          },
          figures: simulatedFigures
        })
      });

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        if (text.includes("Cookie check") || text.includes("Action required to load your app")) {
          setError("COOKIE_CHECK");
          return;
        }
        console.error("Non-JSON response received:", text);
        throw new Error(`Server returned non-JSON response (${response.status})`);
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Export failed");
      }

      const report = await response.json();
      setFinalReport(report);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Rapor oluşturulamadı.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg text-text-primary p-6 flex flex-col gap-6 max-w-[1600px] mx-auto overflow-hidden">
      <header className="border-b border-border pb-4 flex justify-between items-end">
        <div>
          <motion.h1 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl font-serif text-accent mb-2"
          >
            Azolla Erken Stres Tespiti Araştırma Metodolojisi
          </motion.h1>
          <div className="flex gap-6 items-center">
            <nav className="flex bg-white/5 rounded-lg p-1 border border-border">
              {[
                { id: "analysis", label: "Analiz", icon: Activity },
                { id: "trends", label: "Trendler", icon: TrendingUp },
                { id: "history", label: "Geçmiş", icon: HistoryIcon },
                { id: "validation", label: "Validasyon", icon: ShieldCheck },
                { id: "ai", label: "AI Analizi", icon: Zap }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs transition-all ${activeTab === tab.id ? 'bg-accent text-bg font-bold' : 'text-text-secondary hover:text-white'}`}
                >
                  <tab.icon size={14} /> {tab.label}
                </button>
              ))}
            </nav>
            <p className="text-xs text-text-secondary italic">
              Aşama 3 & 4: Özellik Çıkarımı ve Zamansal Analiz
            </p>
          </div>
        </div>
        <div className="flex gap-3 items-center">
          <button 
            onClick={handleAIAnalysis}
            disabled={!result || isAIAnalyzing}
            className="flex items-center gap-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/30 px-4 py-2 rounded-lg transition-all disabled:opacity-50"
          >
            {isAIAnalyzing ? <RefreshCw className="animate-spin" size={18} /> : <Zap size={18} />}
            AI Analizi
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isAnalyzing}
            className="flex items-center gap-2 bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 px-4 py-2 rounded-lg transition-all disabled:opacity-50"
          >
            {isAnalyzing ? <RefreshCw className="animate-spin" size={18} /> : <Upload size={18} />}
            {isAnalyzing ? "Görüntü Ekle" : "Yeni Görüntü"}
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleUpload} 
            accept="image/*" 
            className="hidden" 
          />
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-[350px_1fr_350px] gap-6 flex-1 min-h-0">
        {/* Left: Methodology & Status */}
        <div className="flex flex-col gap-6 overflow-y-auto">
          <motion.section 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="card"
          >
            <div className="card-title flex items-center gap-2">
              <ShieldCheck size={14} /> Stres Karar Mekanizması
            </div>
            <div className="space-y-4">
              <div className="p-4 bg-white/5 rounded-lg border border-border space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-text-secondary">Erken Stres Olasılığı</span>
                  <span className={`text-sm font-bold ${temporalAnalysis && temporalAnalysis.early_stress_prob > 0.6 ? 'text-orange-400' : 'text-accent'}`}>
                    {temporalAnalysis ? `%${(temporalAnalysis.early_stress_prob * 100).toFixed(0)}` : "N/A"}
                  </span>
                </div>
                <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: temporalAnalysis ? `${temporalAnalysis.early_stress_prob * 100}%` : 0 }}
                    className={`h-full ${temporalAnalysis && temporalAnalysis.early_stress_prob > 0.6 ? 'bg-orange-400' : 'bg-accent'}`}
                  />
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="text-xs text-text-secondary">Karar Durumu</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                    temporalAnalysis?.decision === 'late_damage' ? 'bg-red-500/20 text-red-400' : 
                    temporalAnalysis?.decision === 'early_stress' ? 'bg-orange-500/20 text-orange-400' : 
                    'bg-green-500/20 text-green-400'
                  }`}>
                    {temporalAnalysis ? (
                      temporalAnalysis.decision === 'late_damage' ? "GEÇ HASAR" : 
                      temporalAnalysis.decision === 'early_stress' ? "ERKEN STRES" : "NORMAL"
                    ) : "N/A"}
                  </span>
                </div>
              </div>

              {temporalAnalysis && (
                <div className="p-3 bg-accent/5 rounded border border-accent/10 space-y-2">
                  <p className="text-[10px] text-accent font-medium flex items-center gap-1">
                    <Info size={10} /> Karar Gerekçesi
                  </p>
                  <p className="text-[10px] text-text-secondary leading-relaxed italic">
                    "{temporalAnalysis.rationale}"
                  </p>
                  {temporalAnalysis.active_indicators.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {temporalAnalysis.active_indicators.map(ind => (
                        <span key={ind} className="text-[8px] bg-white/10 px-1.5 py-0.5 rounded text-text-primary border border-white/5">
                          {ind}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-widest text-text-secondary">İstatistiksel Güven</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-white/5 p-2 rounded border border-border">
                    <p className="text-[9px] text-text-secondary">Güven Skoru</p>
                    <p className="text-xs font-mono text-white">
                      {temporalAnalysis ? `${(temporalAnalysis.confidence * 100).toFixed(1)}%` : "-"}
                    </p>
                  </div>
                  <div className="bg-white/5 p-2 rounded border border-border">
                    <p className="text-[9px] text-text-secondary">FDR α</p>
                    <p className="text-xs font-mono text-white">0.05</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.section>

          <motion.section 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="card"
          >
            <div className="card-title flex items-center gap-2">
              <BarChart3 size={14} /> Özellik Çıkarımı (T{history.length})
            </div>
            <div className="space-y-3 text-[11px]">
              <div className="flex justify-between items-center p-2 bg-white/5 rounded">
                <span className="text-text-secondary">G-Kanal Skewness</span>
                <span className="text-white font-mono">{result?.features?.skew_g.toFixed(3) || "-"}</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-white/5 rounded">
                <span className="text-text-secondary">GLCM Entropy</span>
                <span className="text-white font-mono">{result?.features?.glcm_entropy.toFixed(3) || "-"}</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-white/5 rounded">
                <span className="text-text-secondary">RGRI İndeksi</span>
                <span className="text-white font-mono">{result?.features?.rgri.toFixed(3) || "-"}</span>
              </div>
            </div>
          </motion.section>
        </div>

        {/* Center: Main View */}
        <div className="flex flex-col gap-6">
          <AnimatePresence mode="wait">
            {activeTab === "analysis" && (
              <motion.section 
                key="analysis"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="card flex-1 flex flex-col justify-center items-center relative min-h-[400px]"
              >
                <div className="absolute top-4 left-4 right-4 flex justify-between items-center z-10">
                  <div className="card-title border-none m-0">Görüntü Analizi</div>
                  
                  {result && (
                    <div className="flex items-center gap-3">
                      {/* View Mode Toggles */}
                      <div className="flex bg-black/40 backdrop-blur-md rounded-lg p-1 border border-white/10 shadow-xl">
                        <button 
                          onClick={() => setViewMode("original")}
                          className={`px-3 py-1.5 rounded-md text-[10px] transition-all ${viewMode === "original" ? 'bg-accent text-bg font-bold' : 'text-text-secondary hover:text-white'}`}
                        >
                          Standardize
                        </button>
                        <button 
                          onClick={() => setViewMode("mask")}
                          className={`px-3 py-1.5 rounded-md text-[10px] transition-all ${viewMode === "mask" ? 'bg-accent text-bg font-bold' : 'text-text-secondary hover:text-white'}`}
                        >
                          Maske
                        </button>
                        {result.stressMap && (
                          <button 
                            onClick={() => setViewMode("stress")}
                            className={`px-3 py-1.5 rounded-md text-[10px] transition-all ${viewMode === "stress" ? 'bg-accent text-bg font-bold' : 'text-text-secondary hover:text-white'}`}
                          >
                            Stres Haritası
                          </button>
                        )}
                      </div>

                      {/* Colormap Selector */}
                      <div className="relative">
                        <Palette size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-accent pointer-events-none" />
                        <select 
                          value={colormap}
                          onChange={(e) => {
                            const newColormap = e.target.value as any;
                            setColormap(newColormap);
                            if (lastFileRef.current) {
                              handleUpload(lastFileRef.current);
                            }
                          }}
                          className="bg-black/40 backdrop-blur-md border border-white/10 rounded-lg text-[10px] pl-7 pr-3 py-1.5 text-white outline-none focus:border-accent appearance-none hover:bg-white/10 transition-all cursor-pointer shadow-xl"
                        >
                          <option value="biological">Biyolojik</option>
                          <option value="viridis">Viridis</option>
                          <option value="plasma">Plasma</option>
                          <option value="inferno">Inferno</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
                
                {!result && !isAnalyzing && (
                  <div className="text-center space-y-4">
                    <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto border border-border">
                      <Camera size={32} className="text-border" />
                    </div>
                    <p className="text-text-secondary text-sm">Analiz için bir görüntü ekleyin</p>
                  </div>
                )}

                {isAnalyzing && (
                  <div className="text-center space-y-4">
                    <RefreshCw className="animate-spin text-accent mx-auto" size={48} />
                    <p className="text-accent font-medium">Pipeline Çalışıyor...</p>
                    <div className="text-[10px] text-text-secondary space-y-1">
                      <p>Histogram Momentleri Hesaplanıyor</p>
                      <p>GLCM Tekstür Analizi Yapılıyor</p>
                      <p>Zamansal Karar Mekanizması Tetikleniyor</p>
                    </div>
                  </div>
                )}

                {result && !isAnalyzing && (
                  <div className="w-full h-full flex flex-col gap-4">
                    <div className="relative flex-1 bg-black rounded overflow-hidden border border-border">
                      <img 
                        src={`data:image/${viewMode === "original" || viewMode === "stress" ? "jpeg" : "png"};base64,${
                          viewMode === "original" ? result.processedImage : 
                          viewMode === "mask" ? result.maskImage : 
                          result.stressMap?.overlay
                        }`} 
                        alt="Processed" 
                        className="w-full h-full object-contain"
                      />
                      {viewMode === "stress" && (
                        <div className="absolute bottom-4 right-4 bg-black/80 p-2 rounded border border-white/20 text-[10px] text-white">
                          {colormapLegends[colormap].map((item, idx) => (
                            <div key={idx} className="flex items-center gap-2 mb-1 last:mb-0">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} /> 
                              <span>{item.label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-4">
                      <div className="bg-white/5 p-3 rounded border border-border">
                        <p className="text-[9px] text-text-secondary uppercase mb-1">Kaplama</p>
                        <p className="text-lg font-mono text-white">%{((result.segmentation?.coverage_ratio || 0) * 100).toFixed(1)}</p>
                      </div>
                      <div className="bg-white/5 p-3 rounded border border-border">
                        <p className="text-[9px] text-text-secondary uppercase mb-1">RG Oranı</p>
                        <p className="text-lg font-mono text-white">{result.features?.rg_ratio.toFixed(3)}</p>
                      </div>
                      <div className="bg-white/5 p-3 rounded border border-border">
                        <p className="text-[9px] text-text-secondary uppercase mb-1">Stres Alanı</p>
                        <p className="text-lg font-mono text-white">
                          {result.stressMap ? `%${result.stressMap.metrics.stress_coverage_pct.toFixed(1)}` : "-"}
                        </p>
                      </div>
                      <div className="bg-white/5 p-3 rounded border border-border">
                        <p className="text-[9px] text-text-secondary uppercase mb-1">Stres Skoru</p>
                        <p className="text-lg font-mono text-white">
                          {result.stressMap ? result.stressMap.metrics.mean_stress_score.toFixed(2) : "-"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </motion.section>
            )}

            {activeTab === "trends" && (
              <motion.section 
                key="trends"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="card flex-1 flex flex-col gap-6"
              >
                <div className="card-title">Zamansal Trend Analizi</div>
                {history.length < 2 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-text-secondary space-y-4">
                    <Info size={32} />
                    <p className="text-sm">Trend analizi için en az 2 görüntü gereklidir.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 min-h-0">
                    <div className="bg-white/5 p-4 rounded-lg border border-border flex flex-col">
                      <h3 className="text-xs text-accent mb-4">Erken Stres Olasılığı (EWI)</h3>
                      <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={history.map((h, i) => ({ ...h, prob: (new EarlyStressDecider()).decide(history.slice(0, i + 1)).pop()?.early_stress_prob || 0 }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" />
                            <XAxis 
                              dataKey="timestamp" 
                              tickFormatter={(t) => `T${history.findIndex(h => h.timestamp === t) + 1}`}
                              stroke="#94A3B8"
                              fontSize={10}
                            />
                            <YAxis domain={[0, 1]} stroke="#94A3B8" fontSize={10} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: "#151921", border: "1px solid #2D3748", fontSize: "10px" }}
                            />
                            <Area type="monotone" dataKey="prob" name="Stres Olasılığı" stroke="#F6AD55" fill="#F6AD55" fillOpacity={0.1} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="bg-white/5 p-4 rounded-lg border border-border flex flex-col">
                      <h3 className="text-xs text-accent mb-4">Kaplama ve RG Oranı Değişimi</h3>
                      <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={history}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" />
                            <XAxis 
                              dataKey="timestamp" 
                              tickFormatter={(t) => `T${history.findIndex(h => h.timestamp === t) + 1}`}
                              stroke="#94A3B8"
                              fontSize={10}
                            />
                            <YAxis yAxisId="left" stroke="#4FD1C5" fontSize={10} />
                            <YAxis yAxisId="right" orientation="right" stroke="#F6AD55" fontSize={10} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: "#151921", border: "1px solid #2D3748", fontSize: "10px" }}
                            />
                            <Legend wrapperStyle={{ fontSize: "10px" }} />
                            <Line yAxisId="left" type="monotone" dataKey="coverage" name="Kaplama" stroke="#4FD1C5" strokeWidth={2} dot={{ r: 4 }} />
                            <Line yAxisId="right" type="monotone" dataKey="rg_ratio" name="RG Oranı" stroke="#F6AD55" strokeWidth={2} dot={{ r: 4 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="bg-white/5 p-4 rounded-lg border border-border flex flex-col">
                      <h3 className="text-xs text-accent mb-4">Tekstür Karmaşıklığı (Entropi)</h3>
                      <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={history}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" />
                            <XAxis 
                              dataKey="timestamp" 
                              tickFormatter={(t) => `T${history.findIndex(h => h.timestamp === t) + 1}`}
                              stroke="#94A3B8"
                              fontSize={10}
                            />
                            <YAxis stroke="#94A3B8" fontSize={10} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: "#151921", border: "1px solid #2D3748", fontSize: "10px" }}
                            />
                            <Area type="monotone" dataKey="glcm_entropy" name="Entropi" stroke="#4FD1C5" fill="#4FD1C5" fillOpacity={0.1} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}
              </motion.section>
            )}

            {activeTab === "history" && (
              <motion.section 
                key="history"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="card flex-1 overflow-y-auto"
              >
                <div className="card-title mb-4">Veri Kayıtları</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] border-collapse">
                    <thead>
                      <tr className="border-b border-border text-accent text-left">
                        <th className="p-2">Zaman</th>
                        <th className="p-2">Kaplama</th>
                        <th className="p-2">RG Oranı</th>
                        <th className="p-2">Entropi</th>
                        <th className="p-2">Skew G</th>
                        <th className="p-2">Homojenlik</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((record, i) => (
                        <tr key={i} className="border-b border-border/30 hover:bg-white/5 transition-colors">
                          <td className="p-2 text-text-secondary">T{i + 1}</td>
                          <td className="p-2 text-white font-mono">{(record.coverage * 100).toFixed(1)}%</td>
                          <td className="p-2 text-white font-mono">{record.rg_ratio.toFixed(3)}</td>
                          <td className="p-2 text-white font-mono">{record.glcm_entropy.toFixed(3)}</td>
                          <td className="p-2 text-white font-mono">{record.skew_g.toFixed(3)}</td>
                          <td className="p-2 text-white font-mono">{record.glcm_homogeneity.toFixed(3)}</td>
                        </tr>
                      ))}
                      {history.length === 0 && (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-text-secondary italic">Henüz kayıt bulunmuyor.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </motion.section>
            )}

            {activeTab === "validation" && (
              <motion.section 
                key="validation"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="card flex-1 overflow-y-auto"
              >
                <div className="card-title mb-6 flex justify-between items-center">
                  <span>İstatistiksel Validasyon ve Güven Analizi</span>
                  <div className="flex gap-2">
                    <button 
                      onClick={handleExport}
                      disabled={isExporting || !validationData}
                      className="text-[10px] bg-accent/10 hover:bg-accent/20 text-accent px-3 py-1 rounded border border-accent/20 flex items-center gap-2 transition-all disabled:opacity-50"
                    >
                      {isExporting ? <RefreshCw className="animate-spin" size={10} /> : <FileText size={10} />}
                      Nihai Rapor Oluştur
                    </button>
                    <div className="text-[10px] bg-accent/10 text-accent px-2 py-1 rounded border border-accent/20">
                      Metodolojik Doğrulama Aktif
                    </div>
                  </div>
                </div>

                {!validationData ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-text-secondary space-y-4 py-20">
                    <ShieldCheck size={48} className="opacity-20" />
                    <p className="text-sm">Validasyon motoru için en az 3 veri noktası gereklidir.</p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {/* 1. Cross-Validation Results */}
                    <div className="space-y-4">
                      <h3 className="text-xs font-medium text-accent flex items-center gap-2">
                        <Activity size={14} /> Çapraz Doğrulama (Time Series CV)
                      </h3>
                      <div className="grid grid-cols-4 gap-4">
                        {validationData.cv.map(fold => (
                          <div key={fold.fold} className="bg-white/5 p-3 rounded border border-border">
                            <p className="text-[9px] text-text-secondary mb-1">Fold {fold.fold}</p>
                            <div className="space-y-1">
                              <div className="flex justify-between text-[10px]">
                                <span>Recall:</span>
                                <span className="text-white">{(fold.recall * 100).toFixed(1)}%</span>
                              </div>
                              <div className="flex justify-between text-[10px]">
                                <span>AUC:</span>
                                <span className="text-white">{fold.auc.toFixed(3)}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 2. Bootstrap Confidence Interval */}
                    <div className="space-y-4">
                      <h3 className="text-xs font-medium text-accent flex items-center gap-2">
                        <RefreshCw size={14} /> Bootstrap Güven Aralığı (n=500)
                      </h3>
                      <div className="bg-white/5 p-6 rounded-lg border border-border relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-1 h-full bg-accent" />
                        <div className="flex items-end gap-8">
                          <div className="flex-1">
                            <p className="text-[10px] text-text-secondary mb-2">Ortalama Stres Olasılığı Dağılımı (%95 CI)</p>
                            <div className="h-12 bg-white/10 rounded-md relative flex items-center px-4">
                              <div className="absolute h-full bg-accent/20 border-x border-accent/40" 
                                   style={{ 
                                     left: `${validationData.bootstrap.ci_95[0] * 100}%`, 
                                     right: `${(1 - validationData.bootstrap.ci_95[1]) * 100}%` 
                                   }} 
                              />
                              <div className="absolute w-0.5 h-full bg-accent shadow-[0_0_10px_rgba(79,209,197,0.5)]" 
                                   style={{ left: `${validationData.bootstrap.mean * 100}%` }} 
                              />
                            </div>
                            <div className="flex justify-between mt-2 text-[9px] text-text-secondary">
                              <span>%{ (validationData.bootstrap.ci_95[0] * 100).toFixed(1) }</span>
                              <span className="text-accent font-bold">Ortalama: %{ (validationData.bootstrap.mean * 100).toFixed(1) }</span>
                              <span>%{ (validationData.bootstrap.ci_95[1] * 100).toFixed(1) }</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 3. Statistical Summary */}
                    <div className="space-y-4">
                      <h3 className="text-xs font-medium text-accent flex items-center gap-2">
                        <FileText size={14} /> İstatistiksel Model Özeti (Proxy LME)
                      </h3>
                      <div className="bg-white/5 p-4 rounded border border-border font-mono text-[10px] text-text-secondary leading-relaxed">
                        <p className="text-white mb-2">MixedLM Regression Results</p>
                        <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                          <span>Response Variable:</span> <span className="text-white">early_stress_prob</span>
                          <span>Method:</span> <span className="text-white">REML</span>
                          <span>Groups:</span> <span className="text-white">replicate_id (n=1)</span>
                          <div className="col-span-2 border-t border-border/30 my-2" />
                          <span>Intercept:</span> <span className="text-white">{validationData.summary?.fixedEffects.intercept.toFixed(4)}</span>
                          <span>Time Slope:</span> <span className="text-white">{validationData.summary?.fixedEffects.timeSlope.toFixed(4)}</span>
                          <span>P-Value:</span> <span className={validationData.summary?.significance.isSignificant ? "text-green-400" : "text-red-400"}>
                            {validationData.summary?.significance.pValue}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 4. LaTeX Snippet */}
                    {finalReport && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-4"
                      >
                        <h3 className="text-xs font-medium text-accent flex items-center gap-2">
                          <Zap size={14} /> LaTeX Metodoloji Çıktısı (Tez/Yayın Hazır)
                        </h3>
                        <div className="relative">
                          <pre className="bg-black/40 p-4 rounded border border-border font-mono text-[9px] text-accent/80 overflow-x-auto leading-relaxed">
                            {finalReport.latex_snippet}
                          </pre>
                          <button 
                            onClick={() => navigator.clipboard.writeText(finalReport.latex_snippet)}
                            className="absolute top-2 right-2 p-1.5 bg-white/5 hover:bg-white/10 rounded border border-white/10 text-text-secondary transition-all"
                            title="Kopyala"
                          >
                            <Layers size={12} />
                          </button>
                        </div>
                        <p className="text-[9px] text-text-secondary italic">
                          * Bu tablo, mevcut deney verileri ve validasyon metrikleri kullanılarak otomatik olarak oluşturulmuştur.
                        </p>
                      </motion.div>
                    )}
                  </div>
                )}
              </motion.section>
            )}

            {activeTab === "ai" && (
              <motion.section 
                key="ai"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="card flex-1 overflow-y-auto"
              >
                <div className="card-title mb-6 flex justify-between items-center">
                  <span className="flex items-center gap-2"><Zap className="text-purple-400" size={16} /> Yapay Zeka Destekli Bilimsel Analiz</span>
                  {aiResult && (
                    <div className={`text-[10px] px-3 py-1 rounded border font-bold uppercase ${
                      aiResult.stressLevel === 'Critical' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                      aiResult.stressLevel === 'High' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' :
                      aiResult.stressLevel === 'Moderate' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                      'bg-green-500/20 text-green-400 border-green-500/30'
                    }`}>
                      Stres Seviyesi: {aiResult.stressLevel}
                    </div>
                  )}
                </div>

                {!aiResult && !isAIAnalyzing && (
                  <div className="flex-1 flex flex-col items-center justify-center text-text-secondary space-y-4 py-20">
                    <Zap size={48} className="opacity-20 text-purple-400" />
                    <p className="text-sm">Analiz başlatmak için yukarıdaki "AI Analizi" butonuna tıklayın.</p>
                  </div>
                )}

                {isAIAnalyzing && (
                  <div className="flex-1 flex flex-col items-center justify-center text-purple-400 space-y-4 py-20">
                    <RefreshCw className="animate-spin" size={48} />
                    <p className="text-sm font-medium">Gemini 3.1 Pro Analiz Yapıyor...</p>
                    <div className="text-[10px] text-text-secondary text-center max-w-md">
                      Görüntü özellikleri, zamansal trendler ve biyolojik parametreler çapraz sorgulanıyor.
                    </div>
                  </div>
                )}

                {aiResult && !isAIAnalyzing && (
                  <div className="space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-8">
                      <div className="space-y-6">
                        <div className="space-y-2">
                          <h3 className="text-xs font-bold text-accent uppercase tracking-wider">Özet Değerlendirme</h3>
                          <p className="text-sm text-white leading-relaxed bg-white/5 p-4 rounded-lg border border-border">
                            {aiResult.summary}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <h3 className="text-xs font-bold text-accent uppercase tracking-wider">Bilimsel Bağlam ve Bulgular</h3>
                          <div className="text-sm text-text-secondary leading-relaxed space-y-4">
                            {aiResult.scientificContext.split('\n').map((para, i) => (
                              <p key={i}>{para}</p>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div className="card bg-purple-500/5 border-purple-500/20">
                          <h3 className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-4">Önerilen Aksiyonlar</h3>
                          <ul className="space-y-3">
                            {aiResult.recommendations.map((rec, i) => (
                              <li key={i} className="flex gap-3 text-[11px] text-text-secondary">
                                <CheckCircle2 size={14} className="text-purple-400 shrink-0" />
                                <span>{rec}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="card bg-white/5 border-border">
                          <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-4">Analiz Güveni</h3>
                          <div className="flex items-center gap-4">
                            <div className="relative w-16 h-16">
                              <svg className="w-full h-full" viewBox="0 0 36 36">
                                <path
                                  className="text-white/10"
                                  strokeDasharray="100, 100"
                                  strokeWidth="3"
                                  stroke="currentColor"
                                  fill="none"
                                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                />
                                <path
                                  className="text-purple-400"
                                  strokeDasharray={`${aiResult.confidenceScore * 100}, 100`}
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                  stroke="currentColor"
                                  fill="none"
                                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                />
                              </svg>
                              <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
                                %{(aiResult.confidenceScore * 100).toFixed(0)}
                              </div>
                            </div>
                            <div className="text-[10px] text-text-secondary">
                              Gemini 3.1 Pro tarafından sağlanan istatistiksel güven skoru.
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white/5 p-4 rounded-lg border border-border">
                      <h3 className="text-xs font-bold text-accent uppercase tracking-wider mb-4">AI Destekli Parametrik Analiz</h3>
                      <div className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={history}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" />
                            <XAxis dataKey="timestamp" tickFormatter={(t) => `T${history.findIndex(h => h.timestamp === t) + 1}`} stroke="#94A3B8" fontSize={10} />
                            <YAxis stroke="#94A3B8" fontSize={10} />
                            <Tooltip contentStyle={{ backgroundColor: "#151921", border: "1px solid #2D3748", fontSize: "10px" }} />
                            <Legend wrapperStyle={{ fontSize: "10px" }} />
                            <Line type="monotone" dataKey="rg_ratio" name="RG Oranı (Stres İndikatörü)" stroke="#F6AD55" strokeWidth={2} />
                            <Line type="monotone" dataKey="glcm_entropy" name="Entropi (Doku Karmaşıklığı)" stroke="#4FD1C5" strokeWidth={2} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}
              </motion.section>
            )}
          </AnimatePresence>
        </div>

        {/* Right: Methodology Notes */}
        <div className="flex flex-col gap-6 overflow-y-auto">
          <motion.section 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="card"
          >
            <div className="card-title flex items-center gap-2">
              <AlertTriangle size={14} /> Erken Stres Sinyalleri
            </div>
            <ul className="space-y-4 text-[11px]">
              <li className="relative pl-4">
                <span className="absolute left-0 text-accent">•</span>
                <span className="text-white font-medium block mb-0.5">RG Oranı Artışı:</span>
                <span className="text-text-secondary leading-relaxed">Antosiyanin birikimi nedeniyle R/G oranının %5'ten fazla artması.</span>
              </li>
              <li className="relative pl-4">
                <span className="absolute left-0 text-accent">•</span>
                <span className="text-white font-medium block mb-0.5">Entropi Pozitif Türevi:</span>
                <span className="text-text-secondary leading-relaxed">Doku karmaşıklığının artması (frond kıvrılması).</span>
              </li>
              <li className="relative pl-4">
                <span className="absolute left-0 text-accent">•</span>
                <span className="text-white font-medium block mb-0.5">G-Kanal Negatif Slope:</span>
                <span className="text-text-secondary leading-relaxed">Klorofil bozulmasına bağlı yeşil yoğunluk kaybı.</span>
              </li>
            </ul>
          </motion.section>

          <motion.section 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="card"
          >
            <div className="card-title flex items-center gap-2">
              <FileText size={14} /> Metodolojik Not
            </div>
            <div className="text-[11px] text-text-secondary leading-relaxed space-y-2">
              <p>
                Aşama 4, zamansal türevleri kullanarak stresi hasardan ayırır. Erken stres, büyüme hızı (coverage) henüz düşmeden yakalanır.
              </p>
              <div className="p-2 bg-accent/5 rounded border border-accent/10 text-accent italic">
                "Korelasyon nedensellik değildir; ancak zamansal trend biyolojik gerçektir."
              </div>
            </div>
          </motion.section>
        </div>
      </main>

      <footer className="mt-auto pt-4 border-t border-border text-center">
        <p className="font-serif italic text-xs text-text-secondary">
          Şekil 1: Azolla Karşılaştırmalı Stres Analizinde RGB Veri İşleme ve Zamansal Karar Destek Mekanizması İş Akış Şeması
        </p>
      </footer>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50"
          >
            <div className="bg-red-500/90 backdrop-blur-md text-white px-6 py-4 rounded-xl shadow-2xl border border-white/20 flex items-center gap-4 max-w-md">
              <AlertCircle size={24} />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {error === "COOKIE_CHECK" 
                    ? "Tarayıcı çerezleri engelliyor. Lütfen bağlantıyı düzeltin." 
                    : error}
                </p>
                {error === "COOKIE_CHECK" && (
                  <button 
                    onClick={() => window.open(window.location.href, '_blank')}
                    className="mt-2 text-xs bg-white text-red-500 px-3 py-1 rounded-lg font-bold hover:bg-white/90 transition-colors"
                  >
                    Bağlantıyı Yeni Sekmede Düzelt
                </button>
                )}
              </div>
              <button onClick={() => setError(null)} className="hover:bg-white/20 p-1 rounded-full transition-colors">
                <X size={18} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
