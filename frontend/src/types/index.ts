export type Experiment = { id: number; name: string; description?: string };
export type UploadedImage = { id: number; capture_date?: string | null; date_source?: string | null };

export type TimelinePoint = {
  date: string;
  area_px?: number;
  coverage_ratio?: number;
  area_based_rgr?: number;
  stress_score?: number;
  GLI?: number;
  RednessIndex?: number;
  YellowingIndex?: number;
};
