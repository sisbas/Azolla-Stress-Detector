import { api } from './client';

export const createExperiment = (name: string, description: string) => api.post('/experiments', { name, description });

export const uploadImage = (experimentId: number, file: File) => {
  const form = new FormData();
  form.append('file', file);
  return api.post(`/experiments/${experimentId}/images`, form);
};

export const analyzeImage = (imageId: number) => api.post(`/images/${imageId}/analyze`);
export const updateMask = (imageId: number, payload: unknown) => api.put(`/images/${imageId}/mask`, payload);
export const getTimeline = (experimentId: number) => api.get(`/experiments/${experimentId}/timeline`);
export const compareImages = (experimentId: number, image_id_t1: number, image_id_t2: number) =>
  api.post(`/experiments/${experimentId}/compare`, { image_id_t1, image_id_t2 });
export const addCalibrationData = (experimentId: number, payload: unknown) => api.post(`/experiments/${experimentId}/calibration-data`, payload);
export const trainBiomassModel = (experimentId: number) => api.post(`/experiments/${experimentId}/train-biomass-model`);
export const exportExperiment = (experimentId: number) => api.get(`/experiments/${experimentId}/export`);
