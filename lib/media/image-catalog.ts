import type { ImageProviderId, ImageProviderConfig } from './types';
import { OPENROUTER_DEFAULT_BASE_URL } from './openrouter-default';
export const IMAGE_PROVIDERS: Record<ImageProviderId, ImageProviderConfig> = {
  seedream: {
    id: 'seedream',
    name: 'Seedream',
    requiresApiKey: true,
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com',
    models: [
      { id: 'doubao-seedream-5-0-260128', name: 'Seedream 5.0 Lite' },
      { id: 'doubao-seedream-5-0-lite-260128', name: 'Seedream 5.0 Lite (Alias)' },
      { id: 'doubao-seedream-4-5-251128', name: 'Seedream 4.5' },
      { id: 'doubao-seedream-4-0-250828', name: 'Seedream 4.0' },
    ],
    supportedAspectRatios: ['16:9', '4:3', '1:1', '9:16'],
  },
  'openai-image': {
    id: 'openai-image',
    name: 'OpenAI Image',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-image-2', name: 'GPT Image 2' },
      { id: 'gpt-image-2-2026-04-21', name: 'GPT Image 2 (2026-04-21)' },
      { id: 'gpt-image-1.5', name: 'GPT Image 1.5' },
      { id: 'gpt-image-1', name: 'GPT Image 1' },
      { id: 'gpt-image-1-mini', name: 'GPT Image 1 Mini' },
      { id: 'chatgpt-image-latest', name: 'ChatGPT Image Latest' },
    ],
    supportedAspectRatios: ['16:9', '4:3', '1:1', '9:16'],
  },
  'qwen-image': {
    id: 'qwen-image',
    name: 'Qwen Image',
    requiresApiKey: true,
    defaultBaseUrl: 'https://dashscope.aliyuncs.com',
    models: [
      { id: 'qwen-image-3.0', name: 'Qwen Image 3.0' },
      { id: 'qwen-image-2.0-pro', name: 'Qwen Image 2.0 Pro' },
      { id: 'qwen-image-2.0-pro-2026-03-03', name: 'Qwen Image 2.0 Pro (2026-03-03)' },
      { id: 'qwen-image-2.0', name: 'Qwen Image 2.0' },
      { id: 'qwen-image-2.0-2026-03-03', name: 'Qwen Image 2.0 (2026-03-03)' },
      { id: 'z-image-turbo', name: 'Z-Image Turbo' },
    ],
    supportedAspectRatios: ['16:9', '4:3', '1:1', '9:16'],
  },
  'nano-banana': {
    id: 'nano-banana',
    name: 'Nano Banana (Gemini)',
    requiresApiKey: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    models: [
      { id: 'gemini-nano-banana-2.1', name: 'Nano Banana 2.1' },
      { id: 'gemini-3-pro-image', name: 'Gemini 3 Pro Image (Nano Banana Pro)' },
      {
        id: 'gemini-2.5-flash-image',
        name: 'Gemini 2.5 Flash Image (Nano Banana)',
      },
    ],
    supportedAspectRatios: ['16:9', '4:3', '1:1'],
  },
  'minimax-image': {
    id: 'minimax-image',
    name: 'MiniMax Image',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.minimaxi.com',
    models: [
      { id: 'image-01', name: 'Image 01' },
      { id: 'image-01-live', name: 'Image 01 Live' },
    ],
    supportedAspectRatios: ['16:9', '4:3', '1:1', '9:16'],
  },
  'grok-image': {
    id: 'grok-image',
    name: 'Grok Image (xAI)',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.x.ai/v1',
    models: [{ id: 'grok-imagine-image', name: 'Grok Imagine Image' }],
    supportedAspectRatios: ['16:9', '4:3', '1:1', '9:16'],
  },
  'glm-image': {
    id: 'glm-image',
    name: 'GLM Image (Zhipu)',
    requiresApiKey: true,
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    icon: '/logos/glm.svg',
    models: [
      { id: 'cogview-3-flash', name: 'CogView-3-Flash' },
      { id: 'cogview-4', name: 'CogView-4' },
    ],
    supportedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
  },
  'comfyui-image': {
    id: 'comfyui-image',
    name: 'ComfyUI Image',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:8188',
    // No static models here — real selectable workflows are discovered at
    // runtime from GET /api/comfyui-workflows (files in public/) and picked
    // in Settings. A placeholder id like "comfyui-image" doesn't correspond
    // to any real workflow file, so resolveSelectedModel() would resolve it
    // to a dead path the first time this provider became active (#P2).
    // With models: [], imageModelId resolves to '' when this provider is
    // selected with no workflow chosen yet. In that case (and on the
    // autonomous classroom-media path, which has no model id to pass) the
    // adapter's loadWorkflow() defaults to the first workflow file discovered
    // in public/ via listComfyuiWorkflowFilenames() — not a hard-coded
    // filename, since no particular workflow name is guaranteed to exist.
    models: [],
    supportedAspectRatios: ['16:9', '4:3', '1:1', '9:16'],
    maxResolution: { width: 1920, height: 1920 },
  },
  lemonade: {
    id: 'lemonade',
    name: 'Lemonade',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:13305/v1',
    icon: '/logos/lemonade.svg',
    models: [
      { id: 'Qwen-Image-GGUF', name: 'Qwen Image GGUF' },
      { id: 'sd-cpp', name: 'Stable Diffusion (sd-cpp)' },
    ],
    supportedAspectRatios: ['16:9', '4:3', '1:1', '9:16'],
    maxResolution: { width: 1024, height: 1024 },
  },
  'openrouter-image': {
    id: 'openrouter-image',
    name: 'OpenRouter Image',
    requiresApiKey: true,
    defaultBaseUrl: OPENROUTER_DEFAULT_BASE_URL,
    // Model list is fetched live from OpenRouter's public GET /images/models
    // catalog; this seed keeps the picker usable offline.
    models: [
      { id: 'google/gemini-3-pro-image', name: 'Gemini 3 Pro Image' },
      { id: 'openai/gpt-image-2', name: 'GPT Image 2' },
      { id: 'bytedance-seed/seedream-5-0-pro', name: 'Seedream 5.0 Pro' },
    ],
    supportedAspectRatios: ['16:9', '4:3', '1:1', '9:16'],
  },
};
