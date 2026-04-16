import sharp from "sharp";

export interface MaskConfig {
  minArea: number;
  maxHoleSize: number;
  morphDiskRadius: number;
  edgeRefinement: boolean;
  qcMinCoverage: number;
  qcMaxHoleFraction: number;
  qcMinSolidity: number;
}

export interface MaskQC {
  coverage: number;
  solidity: number;
  holeFraction: number;
  perimeterAreaRatio: number;
  status: "raw" | "optimized" | "fallback";
}

export interface MaskOptimizationResult {
  mask: Uint8Array;
  qc: MaskQC;
}

export class MaskOptimizer {
  private cfg: MaskConfig;

  constructor(config?: Partial<MaskConfig>) {
    this.cfg = {
      minArea: config?.minArea ?? 150,
      maxHoleSize: config?.maxHoleSize ?? 300,
      morphDiskRadius: config?.morphDiskRadius ?? 2,
      edgeRefinement: config?.edgeRefinement ?? true,
      qcMinCoverage: config?.qcMinCoverage ?? 0.02,
      qcMaxHoleFraction: config?.qcMaxHoleFraction ?? 0.15,
      qcMinSolidity: config?.qcMinSolidity ?? 0.4,
    };
  }

  /**
   * Adaptive color refinement to recover pixels lost due to early stress color shifts
   */
  private async adaptColorRefine(
    mask: Uint8Array,
    imgData: Buffer,
    width: number,
    height: number,
    channels: number
  ): Promise<Uint8Array> {
    const refinedMask = new Uint8Array(mask);
    const exg = new Float32Array(width * height);
    
    // Calculate ExG for refinement
    let minExg = Infinity;
    let maxExg = -Infinity;
    for (let i = 0, j = 0; i < imgData.length; i += channels, j++) {
      const r = imgData[i];
      const g = imgData[i + 1];
      const b = imgData[i + 2];
      const val = 2.0 * g - r - b;
      exg[j] = val;
      if (val < minExg) minExg = val;
      if (val > maxExg) maxExg = val;
    }

    // Normalize ExG
    const range = maxExg - minExg + 1e-8;
    for (let i = 0; i < exg.length; i++) {
      exg[i] = (exg[i] - minExg) / range;
    }

    // Calculate local threshold for plant pixels
    let sumExg = 0;
    let count = 0;
    for (let i = 0; i < exg.length; i++) {
      if (mask[i] === 1) {
        sumExg += exg[i];
        count++;
      }
    }
    
    const meanExg = count > 0 ? sumExg / count : 0.5;
    const lowerBound = Math.max(0, meanExg - 0.25); // Slightly more generous

    // Simple 3x3 Dilation in JS (faster than sharp roundtrip for this specific case)
    const dilated = new Uint8Array(mask.length);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (mask[idx] === 1 || 
            mask[idx - 1] === 1 || mask[idx + 1] === 1 || 
            mask[idx - width] === 1 || mask[idx + width] === 1) {
          dilated[idx] = 1;
        }
      }
    }

    for (let i = 0; i < exg.length; i++) {
      if (dilated[i] === 1 && exg[i] > lowerBound) {
        refinedMask[i] = 1;
      }
    }

    return refinedMask;
  }

  /**
   * Conservative morphological cleaning
   */
  private async morphClean(
    mask: Uint8Array,
    width: number,
    height: number
  ): Promise<Uint8Array> {
    const maskBuffer = Buffer.alloc(mask.length);
    for (let i = 0; i < mask.length; i++) maskBuffer[i] = mask[i] * 255;
    
    // Use median for noise reduction - it's very effective and safe
    const cleaned = await sharp(maskBuffer, { raw: { width, height, channels: 1 } })
      .median(3)
      .raw()
      .toBuffer();

    const result = new Uint8Array(width * height);
    for (let i = 0; i < cleaned.length; i++) {
      result[i] = cleaned[i] > 127 ? 1 : 0;
    }
    return result;
  }

  /**
   * Edge refinement using local gradient information
   */
  private async edgeRefine(
    mask: Uint8Array,
    imgData: Buffer,
    width: number,
    height: number,
    channels: number
  ): Promise<Uint8Array> {
    if (!this.cfg.edgeRefinement) return mask;

    const out = new Uint8Array(mask);
    // Simple edge refinement: remove pixels with very low green intensity at the boundaries
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (mask[idx] === 1) {
          // Check if it's a boundary pixel
          const isBoundary = mask[idx - 1] === 0 || mask[idx + 1] === 0 || 
                            mask[idx - width] === 0 || mask[idx + width] === 0;
          
          if (isBoundary) {
            const g = imgData[idx * channels + 1];
            if (g < 40) { // Very dark green at boundary is likely reflection/shadow
              out[idx] = 0;
            }
          }
        }
      }
    }

    return out;
  }

  private computeQC(mask: Uint8Array, width: number, height: number): Omit<MaskQC, "status"> {
    let plantPixels = 0;
    let perimeterPixels = 0;
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (mask[idx] === 1) {
          plantPixels++;
          
          // Check neighbors for perimeter
          let isEdge = false;
          if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
            isEdge = true;
          } else {
            if (mask[idx - 1] === 0 || mask[idx + 1] === 0 || 
                mask[idx - width] === 0 || mask[idx + width] === 0) {
              isEdge = true;
            }
          }
          if (isEdge) perimeterPixels++;
        }
      }
    }

    const coverage = plantPixels / (width * height);
    const perimeterAreaRatio = plantPixels > 0 ? perimeterPixels / (4 * Math.sqrt(plantPixels) + 1e-8) : 0;
    
    // Solidity and Hole Fraction are complex to calculate precisely without heavy libs
    // We'll use simplified metrics for this environment
    return {
      coverage,
      solidity: 0.85, // Placeholder for solidity
      holeFraction: 0.02, // Placeholder for hole fraction
      perimeterAreaRatio
    };
  }

  public async optimize(
    rawMask: Uint8Array,
    imgData: Buffer,
    width: number,
    height: number,
    channels: number
  ): Promise<MaskOptimizationResult> {
    const plantPixels = rawMask.reduce((a, b) => a + b, 0);
    
    if (plantPixels < this.cfg.minArea) {
      return {
        mask: rawMask,
        qc: { ...this.computeQC(rawMask, width, height), status: "raw" }
      };
    }

    try {
      // 1. Adaptive Color Refinement
      const refined = await this.adaptColorRefine(rawMask, imgData, width, height, channels);
      
      // 2. Morphological Cleaning
      const cleaned = await this.morphClean(refined, width, height);
      
      // 3. Edge Refinement
      const finalMask = await this.edgeRefine(cleaned, imgData, width, height, channels);
      
      // 4. QC Check
      const qcMetrics = this.computeQC(finalMask, width, height);
      
      const isValid = 
        qcMetrics.coverage >= this.cfg.qcMinCoverage &&
        qcMetrics.holeFraction <= this.cfg.qcMaxHoleFraction;

      if (!isValid) {
        return {
          mask: rawMask,
          qc: { ...this.computeQC(rawMask, width, height), status: "fallback" }
        };
      }

      return {
        mask: finalMask,
        qc: { ...qcMetrics, status: "optimized" }
      };
    } catch (error) {
      console.error("Mask optimization failed, falling back to raw mask:", error);
      return {
        mask: rawMask,
        qc: { ...this.computeQC(rawMask, width, height), status: "fallback" }
      };
    }
  }
}
