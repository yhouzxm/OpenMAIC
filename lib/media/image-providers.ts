/**
 * Image Generation Service -- routes to provider adapters
 */

import type {
  ImageProviderId,
  ImageGenerationConfig,
  ImageGenerationOptions,
  ImageGenerationResult,
  ImageProviderConfig,
} from './types';
import { generateWithSeedream, testSeedreamConnectivity } from './adapters/seedream-adapter';
import {
  generateWithOpenAIImage,
  testOpenAIImageConnectivity,
} from './adapters/openai-image-adapter';
import { generateWithQwenImage, testQwenImageConnectivity } from './adapters/qwen-image-adapter';
import { generateWithNanoBanana, testNanoBananaConnectivity } from './adapters/nano-banana-adapter';
import {
  generateWithMiniMaxImage,
  testMiniMaxImageConnectivity,
} from './adapters/minimax-image-adapter';
import { generateWithGrokImage, testGrokImageConnectivity } from './adapters/grok-image-adapter';
import { generateWithGlmImage, testGlmImageConnectivity } from './adapters/glm-image-adapter';
import {
  generateWithComfyuiImage,
  testComfyuiImageConnectivity,
} from './adapters/comfyui-image-adapter';
import {
  generateWithLemonadeImage,
  testLemonadeImageConnectivity,
} from './adapters/lemonade-image-adapter';
import {
  generateWithOpenRouterImage,
  testOpenRouterImageConnectivity,
  OPENROUTER_DEFAULT_BASE_URL,
} from './adapters/openrouter-image-adapter';

import { IMAGE_PROVIDERS } from './image-catalog';
export { IMAGE_PROVIDERS } from './image-catalog';

export async function testImageConnectivity(
  config: ImageGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  switch (config.providerId) {
    case 'seedream':
      return testSeedreamConnectivity(config);
    case 'openai-image':
      return testOpenAIImageConnectivity(config);
    case 'qwen-image':
      return testQwenImageConnectivity(config);
    case 'nano-banana':
      return testNanoBananaConnectivity(config);
    case 'minimax-image':
      return testMiniMaxImageConnectivity(config);
    case 'grok-image':
      return testGrokImageConnectivity(config);
    case 'glm-image':
      return testGlmImageConnectivity(config);
    case 'comfyui-image':
      return testComfyuiImageConnectivity(config);
    case 'lemonade':
      return testLemonadeImageConnectivity(config);
    case 'openrouter-image':
      return testOpenRouterImageConnectivity(config);
    default:
      return {
        success: false,
        message: `Unsupported image provider: ${config.providerId}`,
      };
  }
}

export async function generateImage(
  config: ImageGenerationConfig,
  options: ImageGenerationOptions,
): Promise<ImageGenerationResult> {
  switch (config.providerId) {
    case 'seedream':
      return generateWithSeedream(config, options);
    case 'openai-image':
      return generateWithOpenAIImage(config, options);
    case 'qwen-image':
      return generateWithQwenImage(config, options);
    case 'nano-banana':
      return generateWithNanoBanana(config, options);
    case 'minimax-image':
      return generateWithMiniMaxImage(config, options);
    case 'grok-image':
      return generateWithGrokImage(config, options);
    case 'glm-image':
      return generateWithGlmImage(config, options);
    case 'comfyui-image':
      return generateWithComfyuiImage(config, options);
    case 'lemonade':
      return generateWithLemonadeImage(config, options);
    case 'openrouter-image':
      return generateWithOpenRouterImage(config, options);
    default:
      throw new Error(`Unsupported image provider: ${config.providerId}`);
  }
}

export function aspectRatioToDimensions(
  ratio: string,
  maxWidth = 1024,
): { width: number; height: number } {
  const [w, h] = ratio.split(':').map(Number);
  if (!w || !h) return { width: maxWidth, height: Math.round((maxWidth * 9) / 16) };
  return { width: maxWidth, height: Math.round((maxWidth * h) / w) };
}

/**
 * Scale a width/height pair up to a minimum pixel area while preserving the
 * aspect ratio, rounding both edges up to a multiple of 8 (common provider
 * alignment). A no-op for a non-positive floor or degenerate dimensions.
 */
export function applyMinPixelFloor(
  width: number,
  height: number,
  minPixels: number,
): { width: number; height: number } {
  if (!(minPixels > 0) || width <= 0 || height <= 0) return { width, height };
  const area = width * height;
  if (area >= minPixels) return { width, height };

  const scale = Math.sqrt(minPixels / area);
  return {
    width: Math.ceil((width * scale) / 8) * 8,
    height: Math.ceil((height * scale) / 8) * 8,
  };
}
