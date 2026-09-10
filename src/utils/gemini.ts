const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK_MODEL = 'models/gemini-3.6-flash';

interface GeminiModel {
  name?: string;
  supportedGenerationMethods?: string[];
}

const modelCache = new Map<string, Promise<string>>();

const modelVersion = (name: string): number[] => {
  const match = name.match(/gemini-(\d+(?:\.\d+)*)/i);
  return match ? match[1].split('.').map(Number) : [0];
};

const compareVersions = (left: number[], right: number[]): number => {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

const modelPriority = (name: string): number => {
  const normalized = name.toLowerCase();
  if (!normalized.includes('flash')) return 0;
  if (normalized.includes('flash-lite') || normalized.includes('flash_lite')) return 1;
  return 2;
};

const discoverBestModel = async (apiKey: string): Promise<string> => {
  try {
    const response = await fetch(`${GEMINI_API_BASE}/models?key=${encodeURIComponent(apiKey)}`);
    if (!response.ok) return FALLBACK_MODEL;

    const data = await response.json() as { models?: GeminiModel[] };
    const models = (data.models || [])
      .map((model) => model.name || '')
      .filter((name) => name && name.startsWith('models/') && name.toLowerCase().includes('gemini'));

    const supportedModels = (data.models || [])
      .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
      .map((model) => model.name || '')
      .filter((name) => name && name.startsWith('models/') && name.toLowerCase().includes('gemini'));

    const candidates = supportedModels.length > 0 ? supportedModels : models;
    candidates.sort((left, right) => {
      const priorityDifference = modelPriority(right) - modelPriority(left);
      return priorityDifference || compareVersions(modelVersion(right), modelVersion(left));
    });

    return candidates[0] || FALLBACK_MODEL;
  } catch {
    return FALLBACK_MODEL;
  }
};

export const getBestGeminiModel = (apiKey: string): Promise<string> => {
  const cachedModel = modelCache.get(apiKey);
  if (cachedModel) return cachedModel;

  const model = discoverBestModel(apiKey);
  modelCache.set(apiKey, model);
  return model;
};

export const getGeminiGenerateContentUrl = async (apiKey: string): Promise<string> => {
  const model = await getBestGeminiModel(apiKey);
  return `${GEMINI_API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
};
