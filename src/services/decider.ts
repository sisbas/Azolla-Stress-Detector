import { FeatureRecord } from "./analyzer";
export type { FeatureRecord };

export interface DecisionRecord {
  timestamp: number;
  early_stress_prob: number;
  decision: "normal" | "early_stress" | "late_damage";
  confidence: number;
  active_indicators: string[];
  statistical_pvals: Record<string, number>;
  rationale: string;
}

export class EarlyStressDecider {
  private alpha: number;
  private earlyWeights: Record<string, number>;
  private lateCoverageDrop: number;
  private minConcordant: number;

  constructor(
    alpha: number = 0.05,
    earlyWeights?: Record<string, number>,
    lateCoverageDrop: number = -0.3,
    minConcordant: number = 2
  ) {
    this.alpha = alpha;
    this.earlyWeights = earlyWeights || {
      rg_ratio_pct: 0.3,
      mean_g_pct: 0.25,
      glcm_entropy_pct: 0.2,
      coverage_pct: 0.15,
      trend_consistency: 0.1,
    };
    this.lateCoverageDrop = lateCoverageDrop;
    this.minConcordant = minConcordant;
    this.normalizeWeights();
  }

  private normalizeWeights() {
    const s = Object.values(this.earlyWeights).reduce((a, b) => a + b, 0);
    if (Math.abs(s - 1.0) > 1e-6) {
      for (const k in this.earlyWeights) {
        this.earlyWeights[k] /= s;
      }
    }
  }

  private zToP(z: number): number {
    const absZ = Math.abs(z);
    // Standard normal cumulative distribution approximation
    const t = 1 / (1 + 0.2316419 * absZ);
    const d = 0.3989423 * Math.exp((-absZ * absZ) / 2);
    const p =
      d *
      t *
      (0.3193815 +
        t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return 2 * p;
  }

  private benjaminiHochberg(pValues: number[]): number[] {
    const n = pValues.length;
    if (n === 0) return [];
    const sorted = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
    const adjusted = new Array(n);
    let minP = 1;
    for (let k = n; k >= 1; k--) {
      const { p, i } = sorted[k - 1];
      minP = Math.min(minP, (p * n) / k);
      adjusted[i] = minP;
    }
    return adjusted;
  }

  private statisticalTest(
    row: any,
    baselineStats: Record<string, { mean: number; std: number }>
  ): { pVals: Record<string, number>; sig: Record<string, boolean> } {
    const pVals: Record<string, number> = {};
    const feats = Object.keys(this.earlyWeights).filter((f) => f.endsWith("_pct"));

    for (const feat of feats) {
      const stats = baselineStats[feat] || { mean: 0, std: 0.05 };
      const curr = row[feat] || 0;
      const z = Math.abs(curr - stats.mean) / (stats.std + 1e-8);
      pVals[feat] = this.zToP(z);
    }

    const featKeys = Object.keys(pVals);
    const rawP = featKeys.map((k) => pVals[k]);
    const adjP = this.benjaminiHochberg(rawP);

    const adjustedPVals: Record<string, number> = {};
    const sig: Record<string, boolean> = {};

    featKeys.forEach((key, i) => {
      adjustedPVals[key] = adjP[i];
      sig[key] = adjP[i] < this.alpha;
    });

    return { pVals: adjustedPVals, sig };
  }

  private trendConsistency(history: any[], window: number = 3): number {
    if (history.length < 2) return 0;
    const sub = history.slice(-window);
    if (sub.length < 2) return 0;

    let matches = 0;
    let total = 0;

    const expected = {
      mean_g_d1: -1,
      rg_ratio_d1: 1,
      glcm_entropy_d1: 1,
    };

    for (let i = 1; i < sub.length; i++) {
      const dt = (sub[i].timestamp - sub[i - 1].timestamp) / 1000 || 1;
      const slopes = {
        mean_g_d1: (sub[i].mean_g - sub[i - 1].mean_g) / dt,
        rg_ratio_d1: (sub[i].rg_ratio - sub[i - 1].rg_ratio) / dt,
        glcm_entropy_d1: (sub[i].glcm_entropy - sub[i - 1].glcm_entropy) / dt,
      };

      for (const [feat, exp] of Object.entries(expected)) {
        const val = (slopes as any)[feat];
        if (Math.sign(val) === exp) {
          matches++;
        }
        total++;
      }
    }

    return total === 0 ? 0 : matches / total;
  }

  private phaseFlag(row: any): string {
    if ((row.coverage_pct || 0) < this.lateCoverageDrop * 100) {
      return "late_damage";
    }
    // Only trigger late_damage if skew is VERY high or entropy derivative is EXTREME
    if ((row.skew_g || 0) > 5.0 || (row.glcm_entropy_d1 || 0) > 0.5) {
      return "late_damage";
    }
    return "non_late";
  }

  private computeProbability(row: any, trendScore: number): number {
    let prob = 0;
    for (const [feat, w] of Object.entries(this.earlyWeights)) {
      if (feat === "trend_consistency") {
        prob += trendScore * w;
      } else {
        const val = Math.abs(row[feat] || 0);
        const score = feat.endsWith("_pct") ? Math.min(val / 50.0, 1.0) : Math.min(val, 1.0);
        prob += score * w;
      }
    }
    return Math.max(0, Math.min(1, prob));
  }

  public decide(history: FeatureRecord[]): DecisionRecord[] {
    if (history.length === 0) return [];

    const baseline = history[0];
    const baselineStats: Record<string, { mean: number; std: number }> = {
      rg_ratio_pct: { mean: 0, std: 5 },
      mean_g_pct: { mean: 0, std: 5 },
      glcm_entropy_pct: { mean: 0, std: 5 },
      coverage_pct: { mean: 0, std: 5 },
    };

    const records: DecisionRecord[] = [];

    for (let i = 0; i < history.length; i++) {
      const current = history[i];
      const prev = i > 0 ? history[i - 1] : current;
      const dt = (current.timestamp - prev.timestamp) / 1000 || 1;

      // Prepare row with deltas and derivatives
      const row: any = {
        ...current,
        rg_ratio_pct: ((current.rg_ratio - baseline.rg_ratio) / (baseline.rg_ratio + 1e-8)) * 100,
        mean_g_pct: ((current.mean_g - baseline.mean_g) / (baseline.mean_g + 1e-8)) * 100,
        glcm_entropy_pct: ((current.glcm_entropy - baseline.glcm_entropy) / (baseline.glcm_entropy + 1e-8)) * 100,
        coverage_pct: ((current.coverage - baseline.coverage) / (baseline.coverage + 1e-8)) * 100,
        glcm_entropy_d1: (current.glcm_entropy - prev.glcm_entropy) / dt,
      };

      const phase = this.phaseFlag(row);

      if (phase === "late_damage") {
        records.push({
          timestamp: current.timestamp,
          early_stress_prob: 0.95,
          decision: "late_damage",
          confidence: 0.8,
          active_indicators: ["area_collapse", "texture_jump"],
          statistical_pvals: {},
          rationale: "Geç dönem hasar eşiği aşıldı; erken pencere kapandı.",
        });
        continue;
      }

      const { pVals, sig } = this.statisticalTest(row, baselineStats);
      const active = Object.keys(sig).filter((k) => sig[k]);
      const trend = this.trendConsistency(history.slice(0, i + 1));
      const prob = this.computeProbability(row, trend);

      const tauProb = 0.45;
      const concordant = active.length;

      let decision: "normal" | "early_stress" | "late_damage" = "normal";
      let confidence = 0;
      let rationale = "";

      if (prob >= tauProb && concordant >= this.minConcordant) {
        decision = "early_stress";
        confidence = Math.min(prob, 1.0);
        rationale = `İstatistiksel sapma ve trend tutarlılığı erken stresi destekliyor (FDR α=${this.alpha}).`;
      } else {
        decision = "normal";
        confidence = Math.max(0.5, 1.0 - prob);
        rationale = "Erken stres kriterleri karşılanmadı; bazal varyasyon veya gecikmiş tepki.";
      }

      records.push({
        timestamp: current.timestamp,
        early_stress_prob: Number(prob.toFixed(3)),
        decision,
        confidence: Number(confidence.toFixed(3)),
        active_indicators: active,
        statistical_pvals: pVals,
        rationale,
      });
    }

    return records;
  }
}
