export interface ProviderModel {
  name: string;
  model_id: string;
  properties: { context_length: number; max_output_tokens: number };
}

export interface SavedProvider {
  name: string;
  manifest: {
    type: string;
    base_url?: string;
    models: ProviderModel[];
    hasCredential: boolean;
  };
}

export interface ProviderPreset {
  id: string;
  label: string;
  note: string;
  endpoint?: string;
  models?: ProviderModel[];
}

const model = (name: string, model_id: string, context_length = 131072): ProviderModel =>
  ({ name, model_id, properties: { context_length, max_output_tokens: 8192 } });

export const providerPresets: readonly ProviderPreset[] = [
  { id: 'openrouter', label: 'OpenRouter', note: 'Free model variants with a shared request quota.', endpoint: 'https://openrouter.ai/api/v1', models: [
    model('particle-1-free', 'particle-ai/particle-1:free', 1048576), model('gpt-oss-120b-free', 'openai/gpt-oss-120b:free'),
  ] },
  { id: 'workers-ai', label: 'Workers AI', note: 'Cloudflare-hosted models with a daily free allowance.', models: [
    model('gpt-oss-120b', '@cf/openai/gpt-oss-120b', 128000), model('gpt-oss-20b', '@cf/openai/gpt-oss-20b', 128000),
    model('glm-4-7-flash', '@cf/zai-org/glm-4.7-flash', 131072),
  ] },
  { id: 'groq', label: 'Groq', note: 'Fast inference with a smaller free token-per-minute limit.', endpoint: 'https://api.groq.com/openai/v1', models: [
    model('gpt-oss-120b', 'openai/gpt-oss-120b'), model('gpt-oss-20b', 'openai/gpt-oss-20b'), model('qwen3-8-27b', 'qwen/qwen3.8-27b', 262144),
  ] },
  { id: 'gemini', label: 'Gemini', note: 'Google models and quota from your AI Studio project.' },
  { id: 'cohere', label: 'Cohere', note: 'Command A Reasoning with an evaluation key.', endpoint: 'https://api.cohere.ai/compatibility/v1', models: [
    model('command-a-reasoning', 'command-a-reasoning-08-2025', 256000),
  ] },
  { id: 'vercel', label: 'Vercel', note: 'AI Gateway models use your Vercel credit balance.', endpoint: 'https://ai-gateway.vercel.sh/v1', models: [
    model('kimi-k2-7-code', 'moonshotai/kimi-k2.7-code', 262144),
  ] },
  { id: 'custom', label: 'Custom', note: 'Use Ollama or any OpenAI-compatible endpoint configured in TrueForge.' },
];

export interface ProviderGroup {
  id: string;
  label: string;
  note: string;
  models: { name: string; label: string }[];
  presets: string[];
  needsToken: boolean;
}

export function workersAiEndpoint(id: string): string {
  if (!/^[a-f0-9]{32}$/i.test(id)) throw new Error('Enter the 32-character Cloudflare account ID.');
  return `https://api.cloudflare.com/client/v4/accounts/${id.toLowerCase()}/ai/v1`;
}

export function workersAiAccount(endpoint?: string): string | undefined {
  return /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/([a-f0-9]{32})\/ai\/v1\/?$/i.exec(endpoint ?? '')?.[1].toLowerCase();
}

function groupId(name: string, saved?: SavedProvider): string {
  if (name === 'google-gemini' && (!saved || saved.manifest.type === 'google-gemini')) return 'gemini';
  if (saved) {
    if (workersAiAccount(saved.manifest.base_url)) return 'workers-ai';
    return providerPresets.find(preset => preset.endpoint && preset.endpoint === saved.manifest.base_url?.replace(/\/$/, ''))?.id ?? 'custom';
  }
  return providerPresets.some(preset => preset.id === name) ? name : 'custom';
}

export function providerGroups(models: readonly { name: string }[], saved: readonly SavedProvider[]): ProviderGroup[] {
  const groups: ProviderGroup[] = providerPresets.map(({ id, label, note, models }) =>
    ({ id, label, note, models: [], presets: models?.map(model => model.name) ?? [], needsToken: false }));
  const byName = new Map(saved.map(provider => [provider.name, provider]));
  const groupFor = (name: string) => groups.find(group => group.id === groupId(name, byName.get(name)))!;
  for (const provider of saved) {
    const group = groupFor(provider.name);
    if (group.id !== 'custom' && group.id !== 'gemini' && !provider.manifest.hasCredential) group.needsToken = true;
  }
  for (const { name } of models) {
    const separator = name.indexOf('/');
    if (separator < 1) continue;
    const providerName = name.slice(0, separator);
    const group = groupFor(providerName);
    const provider = byName.get(providerName);
    if (provider && !provider.manifest.hasCredential && group.id !== 'custom' && group.id !== 'gemini') continue;
    group.models.push({ name, label: group.id === 'custom' ? name : name.slice(separator + 1) });
  }
  return groups;
}
