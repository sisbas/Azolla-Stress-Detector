import { describe, it, expect } from 'vitest';
import { ValidationEngine } from './validation';
import { FeatureRecord } from './analyzer';

describe('ValidationEngine', () => {
  const mockHistory: FeatureRecord[] = Array.from({ length: 10 }, (_, i) => ({
    timestamp: 1000 * i,
    coverage: 0.5 - i * 0.01,
    mean_r: 100 + i * 5,
    mean_g: 150 - i * 2,
    mean_b: 100,
    r_norm: 0.3,
    g_norm: 0.4,
    rg_ratio: 0.6 + i * 0.05,
    rgri: -0.2,
    skew_g: 0.1,
    kurt_g: 3.0,
    glcm_contrast: 10 + i,
    glcm_entropy: 2.5 + i * 0.2,
    glcm_homogeneity: 0.8 - i * 0.05
  }));

  it('should perform cross-validation and return metrics', () => {
    const engine = new ValidationEngine();
    const results = engine.crossValidate(mockHistory, 3);
    
    expect(results).toHaveLength(3);
    results.forEach(fold => {
      expect(fold.auc).toBeGreaterThan(0.5);
      expect(fold.recall).toBeDefined();
    });
  });

  it('should calculate bootstrap confidence intervals', () => {
    const engine = new ValidationEngine();
    const result = engine.bootstrapConfidence(mockHistory, 100);
    
    expect(result.mean).toBeGreaterThan(0);
    expect(result.ci_95[0]).toBeLessThanOrEqual(result.mean);
    expect(result.ci_95[1]).toBeGreaterThanOrEqual(result.mean);
    expect(result.distribution).toHaveLength(100);
  });

  it('should generate a statistical summary', () => {
    const engine = new ValidationEngine();
    const summary = engine.getStatisticalSummary(mockHistory);
    
    expect(summary).not.toBeNull();
    expect(summary?.fixedEffects.timeSlope).toBeDefined();
    expect(summary?.significance.pValue).toBeLessThan(1);
  });
});
