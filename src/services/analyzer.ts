import sharp from "sharp";
import { PixelStressMapper, StressMetrics } from "./stressMapper";
import { MaskOptimizer, MaskQC } from "./maskOptimizer";

export interface SegmentationQC extends Partial<MaskQC> {
  coverage_ratio: number;
  threshold_value: number;
  threshold_drift: number;
  boundary_roughness: number;
  glare_overlap_pct: number;
  is_valid: boolean;
}

export interface FeatureRecord {
  timestamp: number;
  coverage: number;
  mean_r: number;
  mean_g: number;
  mean_b: number;
  r_norm: number;
  g_norm: number;
  rg_ratio: number;
  rgri: number;
  skew_g: number;
  kurt_g: number;
  glcm_contrast: number;
  glcm_entropy: number;
  glcm_homogeneity: number;
}

export interface AnalysisResult {
  glare_pct: number;
  segmentation?: SegmentationQC;
  features?: FeatureRecord;
  metadata: {
    width: number;
    height: number;
    channels: number;
  };
  processedImage: string; // Base64
  maskImage?: string; // Base64
  stressMap?: {
    overlay: string;
    pseudocolor: string;
    metrics: StressMetrics;
  };
}

export class AzollaPipeline {
  // Baseline values (simulated or stored)
  private bl_median = 0.45;
  private bl_std = 0.12;
  
  private baseline_stats: Record<string, { mean: number; std: number }> = {
    rg_ratio: { mean: 0.42, std: 0.05 },
    g_norm: { mean: 0.38, std: 0.04 },
    exg: { mean: 0.15, std: 0.03 },
    texture_local: { mean: 0.2, std: 0.05 }
  };

  /**
   * Calculates Excess Green Index (ExG)
   * exg = (2.0 * G - R - B)
   */
  private computeExG(data: Buffer, channels: number): Float32Array {
    const exg = new Float32Array(data.length / channels);
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0, j = 0; i < data.length; i += channels, j++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const val = 2.0 * g - r - b;
      exg[j] = val;
      if (val < min) min = val;
      if (val > max) max = val;
    }

    // Normalize to [0, 1]
    const range = max - min + 1e-8;
    for (let i = 0; i < exg.length; i++) {
      exg[i] = (exg[i] - min) / range;
    }

    return exg;
  }

  /**
   * Simple Otsu's Thresholding implementation
   */
  private otsuThreshold(data: Float32Array, lower: number, upper: number): number {
    const bins = 256;
    const hist = new Array(bins).fill(0);
    let count = 0;

    for (const val of data) {
      if (val >= lower && val <= upper) {
        const bin = Math.min(bins - 1, Math.floor(val * (bins - 1)));
        hist[bin]++;
        count++;
      }
    }

    if (count === 0) return this.bl_median;

    let sum = 0;
    for (let i = 0; i < bins; i++) sum += i * hist[i];

    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let maxVar = 0;
    let threshold = 0;

    for (let i = 0; i < bins; i++) {
      wB += hist[i];
      if (wB === 0) continue;
      wF = count - wB;
      if (wF === 0) break;

      sumB += i * hist[i];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const varBetween = wB * wF * (mB - mF) * (mB - mF);

      if (varBetween > maxVar) {
        maxVar = varBetween;
        threshold = i;
      }
    }

    return threshold / (bins - 1);
  }

  /**
   * Calculates skewness and kurtosis
   */
  private calculateMoments(data: number[]): { skew: number; kurt: number } {
    if (data.length < 2) return { skew: 0, kurt: 0 };

    const n = data.length;
    const mean = data.reduce((a, b) => a + b, 0) / n;
    
    let m2 = 0, m3 = 0, m4 = 0;
    for (const x of data) {
      const dev = x - mean;
      const dev2 = dev * dev;
      m2 += dev2;
      m3 += dev2 * dev;
      m4 += dev2 * dev2;
    }

    m2 /= n;
    m3 /= n;
    m4 /= n;

    const std = Math.sqrt(m2);
    if (std === 0) return { skew: 0, kurt: 0 };

    const skew = m3 / (std * std * std);
    const kurt = (m4 / (m2 * m2)) - 3;

    return { skew, kurt };
  }

  /**
   * Simplified GLCM calculation (Horizontal only for efficiency)
   */
  private calculateGLCM(data: Buffer, width: number, height: number, mask: Uint8Array): { contrast: number; entropy: number; homogeneity: number } {
    const levels = 32; // Reduced levels for performance
    const glcm = new Float32Array(levels * levels).fill(0);
    let pairs = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width - 1; x++) {
        const idx1 = y * width + x;
        const idx2 = y * width + (x + 1);

        if (mask[idx1] && mask[idx2]) {
          const v1 = Math.floor((data[idx1] / 256) * levels);
          const v2 = Math.floor((data[idx2] / 256) * levels);
          glcm[v1 * levels + v2]++;
          pairs++;
        }
      }
    }

    if (pairs === 0) return { contrast: 0, entropy: 0, homogeneity: 0 };

    let contrast = 0;
    let entropy = 0;
    let homogeneity = 0;

    for (let i = 0; i < levels; i++) {
      for (let j = 0; j < levels; j++) {
        const p = glcm[i * levels + j] / pairs;
        if (p > 0) {
          contrast += p * (i - j) * (i - j);
          entropy -= p * Math.log2(p);
          homogeneity += p / (1 + (i - j) * (i - j));
        }
      }
    }

    return { contrast, entropy, homogeneity };
  }

  /**
   * Phase 1, 2 & 3: Standardization, Preprocessing, Segmentation & Feature Extraction
   */
  async process(imageBuffer: Buffer, timestamp: number = Date.now(), colormap: any = "biological"): Promise<AnalysisResult> {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;

    // 1. Standardization (Linear Scaling)
    const standardized = await image
      .modulate({ brightness: 1.05 }) // Simulated calibration
      .linear(1.1, 0)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data, info } = standardized;
    const channels = info.channels;

    // 2. Glare Masking
    let glarePixels = 0;
    const glareThreshold = 242;
    const glareMask = new Uint8Array(width * height);

    for (let i = 0, j = 0; i < data.length; i += channels, j++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const gray = (r + g + b) / 3;
      if (gray > glareThreshold) {
        glarePixels++;
        glareMask[j] = 1;
      }
    }
    const glare_pct = (glarePixels / (width * height)) * 100;

    // 3. Segmentation (ExG + Bounded Otsu)
    const exg = this.computeExG(data, channels);
    
    const thresholdTolerance = 2.0;
    const th_lower = Math.max(0.0, this.bl_median - thresholdTolerance * this.bl_std);
    const th_upper = Math.min(1.0, this.bl_median + thresholdTolerance * this.bl_std);
    
    const th = this.otsuThreshold(exg, th_lower, th_upper);
    
    // Create Raw Mask
    const rawMaskArray = new Uint8Array(width * height);
    let rawPlantPixels = 0;
    let glareOverlap = 0;

    const r_vals: number[] = [];
    const g_vals: number[] = [];
    const b_vals: number[] = [];

    for (let i = 0, j = 0; i < data.length; i += channels, j++) {
      if (exg[j] > th && glareMask[j] === 0) {
        rawMaskArray[j] = 1;
        rawPlantPixels++;
      } else {
        rawMaskArray[j] = 0;
      }
      
      if (rawMaskArray[j] === 1 && glareMask[j] === 1) {
        glareOverlap++;
      }
    }

    // 3.1 Mask Optimization (Adaptive Refinement)
    const optimizer = new MaskOptimizer({
      minArea: 100,
      qcMinCoverage: 0.01
    });
    
    const optResult = await optimizer.optimize(rawMaskArray, data, width, height, channels);
    const maskArray = optResult.mask;
    const optQC = optResult.qc;

    // Recalculate plant pixels and values based on optimized mask
    let plantPixels = 0;
    for (let j = 0; j < maskArray.length; j++) {
      if (maskArray[j] === 1) {
        plantPixels++;
        const i = j * channels;
        r_vals.push(data[i]);
        g_vals.push(data[i + 1]);
        b_vals.push(data[i + 2]);
      }
    }

    const coverage = plantPixels / (width * height);
    const th_drift = Math.abs(th - this.bl_median) / this.bl_std;
    const glare_overlap_pct = (glareOverlap / (width * height)) * 100;

    const qc: SegmentationQC = {
      ...optQC,
      coverage_ratio: coverage,
      threshold_value: th,
      threshold_drift: th_drift,
      boundary_roughness: 1.2,
      glare_overlap_pct: glare_overlap_pct,
      is_valid: (coverage > 0.01) && (glare_overlap_pct < 8.0) && (th_drift < 4.0)
    };

    console.log(`Segmentation QC: status=${qc.status}, coverage=${coverage.toFixed(4)}, valid=${qc.is_valid}`);

    // 4. Feature Extraction
    let features: FeatureRecord | undefined;
    if (qc.is_valid && plantPixels > 50) {
      const mean_r = r_vals.reduce((a, b) => a + b, 0) / plantPixels;
      const mean_g = g_vals.reduce((a, b) => a + b, 0) / plantPixels;
      const mean_b = b_vals.reduce((a, b) => a + b, 0) / plantPixels;
      const s = mean_r + mean_g + mean_b + 1e-8;
      
      const { skew, kurt } = this.calculateMoments(g_vals);
      
      // Extract G channel for GLCM
      const g_channel = Buffer.alloc(width * height);
      for (let i = 0, j = 0; i < data.length; i += channels, j++) {
        g_channel[j] = data[i + 1];
      }
      const { contrast, entropy, homogeneity } = this.calculateGLCM(g_channel, width, height, maskArray);

      features = {
        timestamp,
        coverage,
        mean_r,
        mean_g,
        mean_b,
        r_norm: mean_r / s,
        g_norm: mean_g / s,
        rg_ratio: mean_r / (mean_g + 1e-8),
        rgri: (mean_r - mean_g) / (mean_r + mean_g + 1e-8),
        skew_g: skew,
        kurt_g: kurt,
        glcm_contrast: contrast,
        glcm_entropy: entropy,
        glcm_homogeneity: homogeneity
      };
    }

    // Final Visualizations
    const processedImage = await sharp(data, { raw: { width, height, channels } })
      .jpeg({ quality: 90 })
      .toBuffer();

    const maskBuffer = Buffer.alloc(maskArray.length);
    for (let i = 0; i < maskArray.length; i++) {
      maskBuffer[i] = maskArray[i] ? 255 : 0;
    }

    const maskImage = await sharp(maskBuffer, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer();

    const result: AnalysisResult = {
      glare_pct,
      segmentation: qc,
      features,
      metadata: { width, height, channels },
      processedImage: processedImage.toString("base64"),
      maskImage: maskImage.toString("base64"),
    };

    // 5. Pixel-based Stress Mapping
    if (qc.is_valid && plantPixels > 50) {
      const mapper = new PixelStressMapper(this.baseline_stats, { colormap });
      const stressResult = await mapper.process(data, maskArray, width, height, channels, timestamp);
      result.stressMap = stressResult;
    }

    return result;
  }
}
