import sharp from "sharp";

export type ColormapType = "biological" | "viridis" | "plasma" | "inferno";

export interface StressMapConfig {
  weights: Record<string, number>;
  z_threshold: number;
  spatial_smooth_sigma: number;
  alpha_overlay: number;
  score_range: [number, number];
  colormap: ColormapType;
}

export interface StressMetrics {
  timestamp?: number;
  stress_coverage_pct: number;
  mean_stress_score: number;
  max_stress_score: number;
}

export interface StressMapResult {
  overlay: string; // Base64
  pseudocolor: string; // Base64
  metrics: StressMetrics;
}

export class PixelStressMapper {
  private bl_stats: Record<string, { mean: number; std: number }>;
  private cfg: StressMapConfig;

  constructor(
    baseline_stats: Record<string, { mean: number; std: number }>,
    config?: Partial<StressMapConfig>
  ) {
    this.bl_stats = baseline_stats;
    this.cfg = {
      weights: config?.weights || {
        rg_ratio: 0.45,
        g_norm: 0.35,
        exg: 0.20
      },
      z_threshold: config?.z_threshold || 1.2,
      spatial_smooth_sigma: config?.spatial_smooth_sigma || 1.0,
      alpha_overlay: config?.alpha_overlay || 0.6,
      score_range: config?.score_range || [0.0, 3.0],
      colormap: config?.colormap || "biological"
    };
  }

  /**
   * Interpolates between colors for pseudocolor mapping
   */
  private getStressColor(normScore: number): [number, number, number] {
    let colors: [number, number, number][] = [];

    switch (this.cfg.colormap) {
      case "viridis":
        colors = [
          [68, 1, 84],   // Purple
          [59, 81, 139],  // Blue
          [33, 144, 141], // Teal
          [93, 201, 98],  // Green
          [253, 231, 37]  // Yellow
        ];
        break;
      case "plasma":
        colors = [
          [13, 8, 135],   // Dark Blue
          [126, 3, 168],  // Purple
          [204, 71, 120], // Pink
          [248, 149, 64], // Orange
          [240, 249, 33]  // Yellow
        ];
        break;
      case "inferno":
        colors = [
          [0, 0, 4],      // Black
          [87, 16, 110],  // Dark Purple
          [187, 55, 84],  // Red-Pink
          [249, 142, 9],   // Orange
          [252, 255, 164] // Pale Yellow
        ];
        break;
      case "biological":
      default:
        colors = [
          [46, 204, 113],  // Green
          [241, 196, 15],  // Yellow
          [230, 126, 34],  // Orange
          [231, 76, 60],   // Red
          [192, 57, 43]    // Dark Red
        ];
        break;
    }

    if (normScore <= 0) return colors[0];
    if (normScore >= 1) return colors[colors.length - 1];

    const scaled = normScore * (colors.length - 1);
    const idx = Math.floor(scaled);
    const factor = scaled - idx;

    const c1 = colors[idx];
    const c2 = colors[idx + 1];

    return [
      Math.round(c1[0] * (1 - factor) + c2[0] * factor),
      Math.round(c1[1] * (1 - factor) + c2[1] * factor),
      Math.round(c1[2] * (1 - factor) + c2[2] * factor)
    ];
  }

  public async process(
    imgData: Buffer,
    mask: Uint8Array,
    width: number,
    height: number,
    channels: number,
    timestamp?: number
  ): Promise<StressMapResult> {
    const pixelCount = width * height;
    const scoreMap = new Float32Array(pixelCount).fill(0);
    
    // 1. Compute Pixel Features & Z-Scores
    const r_norm = new Float32Array(pixelCount);
    const g_norm = new Float32Array(pixelCount);
    const rg_ratio = new Float32Array(pixelCount);
    const exg = new Float32Array(pixelCount);

    for (let i = 0, j = 0; i < imgData.length; i += channels, j++) {
      if (mask[j] === 0) continue;

      const r = imgData[i];
      const g = imgData[i + 1];
      const b = imgData[i + 2];
      const s = r + g + b + 1e-8;

      r_norm[j] = r / s;
      g_norm[j] = g / s;
      rg_ratio[j] = r / (g + 1e-8);
      exg[j] = (2 * g - r - b) / 255.0; // Normalized ExG
    }

    // 2. Aggregate Stress Score
    const features: Record<string, Float32Array> = { r_norm, g_norm, rg_ratio, exg };
    let totalWeight = 0;

    for (const [feat, weight] of Object.entries(this.cfg.weights)) {
      if (this.bl_stats[feat] && features[feat]) {
        const { mean, std } = this.bl_stats[feat];
        const featMap = features[feat];
        const s = std + 1e-8;

        for (let j = 0; j < pixelCount; j++) {
          if (mask[j] === 1) {
            const z = Math.abs((featMap[j] - mean) / s);
            scoreMap[j] += weight * z;
          }
        }
        totalWeight += weight;
      }
    }

    if (totalWeight > 0) {
      for (let j = 0; j < pixelCount; j++) {
        scoreMap[j] /= totalWeight;
      }
    }

    // 3. Spatial Smoothing (Simulated with Sharp on a buffer)
    const scoreBuffer = Buffer.alloc(pixelCount * 4);
    for (let j = 0; j < pixelCount; j++) {
      scoreBuffer.writeFloatLE(scoreMap[j], j * 4);
    }

    // We use sharp to blur the score map if sigma > 0
    // Note: Sharp blur is in pixels, roughly equivalent to sigma
    let smoothedScoreMap = scoreMap;
    if (this.cfg.spatial_smooth_sigma > 0) {
      // For simplicity in this environment, we'll use a simple box blur or skip if too complex
      // But let's try to use sharp by converting to a grayscale image first
      const tempScoreImg = Buffer.alloc(pixelCount);
      const maxScore = 5.0; // Cap for visualization
      for (let j = 0; j < pixelCount; j++) {
        tempScoreImg[j] = Math.min(255, (scoreMap[j] / maxScore) * 255);
      }

      const blurred = await sharp(tempScoreImg, { raw: { width, height, channels: 1 } })
        .blur(this.cfg.spatial_smooth_sigma)
        .raw()
        .toBuffer();

      for (let j = 0; j < pixelCount; j++) {
        smoothedScoreMap[j] = (blurred[j] / 255) * maxScore;
      }
    }

    // 4. Generate Pseudocolor & Overlay
    const pseudoBuffer = Buffer.alloc(pixelCount * 3);
    const overlayBuffer = Buffer.alloc(pixelCount * 3);
    
    let stressPixels = 0;
    let sumStress = 0;
    let maxStress = 0;
    const [minRange, maxRange] = this.cfg.score_range;

    for (let j = 0; j < pixelCount; j++) {
      const score = mask[j] === 1 ? smoothedScoreMap[j] : 0;
      
      if (mask[j] === 1) {
        if (score > this.cfg.z_threshold) stressPixels++;
        sumStress += score;
        if (score > maxStress) maxStress = score;
      }

      const normScore = Math.max(0, Math.min(1, (score - minRange) / (maxRange - minRange + 1e-8)));
      const [pr, pg, pb] = this.getStressColor(normScore);

      // Pseudocolor: All plant pixels colored
      if (mask[j] === 1) {
        pseudoBuffer[j * 3] = pr;
        pseudoBuffer[j * 3 + 1] = pg;
        pseudoBuffer[j * 3 + 2] = pb;
      } else {
        pseudoBuffer[j * 3] = 0;
        pseudoBuffer[j * 3 + 1] = 0;
        pseudoBuffer[j * 3 + 2] = 0;
      }

      // Overlay: All plant pixels blended
      const alpha = mask[j] === 1 ? this.cfg.alpha_overlay : 0;
      const baseIdx = j * channels;
      
      overlayBuffer[j * 3] = Math.round(imgData[baseIdx] * (1 - alpha) + pr * alpha);
      overlayBuffer[j * 3 + 1] = Math.round(imgData[baseIdx + 1] * (1 - alpha) + pg * alpha);
      overlayBuffer[j * 3 + 2] = Math.round(imgData[baseIdx + 2] * (1 - alpha) + pb * alpha);
    }

    const plantPixels = mask.reduce((a, b) => a + b, 0);
    const metrics: StressMetrics = {
      timestamp,
      stress_coverage_pct: plantPixels > 0 ? (stressPixels / plantPixels) * 100 : 0,
      mean_stress_score: plantPixels > 0 ? sumStress / plantPixels : 0,
      max_stress_score: maxStress
    };

    const overlayBase64 = (await sharp(overlayBuffer, { raw: { width, height, channels: 3 } }).toFormat("jpeg").toBuffer()).toString("base64");
    const pseudoBase64 = (await sharp(pseudoBuffer, { raw: { width, height, channels: 3 } }).toFormat("png").toBuffer()).toString("base64");

    return {
      overlay: overlayBase64,
      pseudocolor: pseudoBase64,
      metrics
    };
  }
}
