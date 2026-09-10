export type AIProvider = 'openai' | 'gemini' | 'openrouter' | 'groq';

interface CompatibleModel {
  id?: string;
  name?: string;
  architecture?: { modality?: string };
  supported_parameters?: string[];
}

const modelCache = new Map<string, Promise<string>>();

const providerConfig: Record<'openai' | 'openrouter' | 'groq', { modelsUrl: string; chatUrl: string; fallback: string }> = {
  openai: {
    modelsUrl: 'https://api.openai.com/v1/models',
    chatUrl: 'https://api.openai.com/v1/chat/completions',
    fallback: 'gpt-4o-mini'
  },
  openrouter: {
    modelsUrl: 'https://openrouter.ai/api/v1/models',
    chatUrl: 'https://openrouter.ai/api/v1/chat/completions',
    fallback: 'google/gemini-2.5-flash'
  },
  groq: {
    modelsUrl: 'https://api.groq.com/openai/v1/models',
    chatUrl: 'https://api.groq.com/openai/v1/chat/completions',
    fallback: 'llama-3.3-70b-versatile'
  }
};

const excludedModel = (id: string): boolean => {
  const normalized = id.toLowerCase();
  return /whisper|tts|audio|embedding|moderation|guard|safeguard|vision/.test(normalized);
};

const modelScore = (id: string, provider: 'openai' | 'openrouter' | 'groq'): number => {
  const normalized = id.toLowerCase();
  let score = 0;
  if (/reason|thinking|sonnet|pro|70b|72b|405b|large/.test(normalized)) score += 5;
  if (/flash|versatile|qwen|llama|deepseek|mistral/.test(normalized)) score += 3;
  if (/mini|small|8b|7b|instant/.test(normalized)) score -= 1;
  if (provider === 'openrouter' && /free/.test(normalized)) score += 1;
  if (provider === 'groq' && /llama-4|qwen3|deepseek-r1/.test(normalized)) score += 2;
  return score;
};

const discoverModel = async (provider: 'openai' | 'openrouter' | 'groq', apiKey: string): Promise<string> => {
  const config = providerConfig[provider];
  try {
    const response = await fetch(config.modelsUrl, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!response.ok) return config.fallback;

    const data = await response.json() as { data?: CompatibleModel[] };
    const candidates = (data.data || [])
      .map((model) => model.id || '')
      .filter((id) => id && !excludedModel(id));

    candidates.sort((left, right) => modelScore(right, provider) - modelScore(left, provider));
    return candidates[0] || config.fallback;
  } catch {
    return config.fallback;
  }
};

export const getBestCompatibleModel = (provider: 'openai' | 'openrouter' | 'groq', apiKey: string): Promise<string> => {
  const cacheKey = `${provider}:${apiKey}`;
  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  const model = discoverModel(provider, apiKey);
  modelCache.set(cacheKey, model);
  return model;
};

export const callCompatibleAI = async (
  prompt: string,
  apiKey: string,
  provider: 'openai' | 'openrouter' | 'groq',
  temperature = 0.7,
  signal?: AbortSignal,
  responseFormat?: 'json_object'
): Promise<string> => {
  const config = providerConfig[provider];
  const model = await getBestCompatibleModel(provider, apiKey);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };

  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/ats-resume-tracker';
    headers['X-Title'] = 'ATS Resume Tracker';
  }

  const response = await fetch(config.chatUrl, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are an expert ATS resume and career advisor. Be precise, truthful, and actionable.' },
        { role: 'user', content: prompt }
      ],
      temperature,
      max_tokens: provider === 'groq' ? 900 : 2000,
      ...(responseFormat ? { response_format: { type: responseFormat } } : {})
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`${provider} API error: ${errorData.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
};
