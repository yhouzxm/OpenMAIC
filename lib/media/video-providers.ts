/**
 * Video Generation Service -- routes to provider adapters
 */

import type {
  VideoProviderId,
  VideoGenerationConfig,
  VideoGenerationOptions,
  VideoGenerationResult,
  VideoProviderConfig,
} from './types';
import type { PolledTaskControl } from './polled-task';
import {
  generateWithSeedance,
  seedanceApiRoot,
  testSeedanceConnectivity,
} from './adapters/seedance-adapter';
import { generateWithKling, testKlingConnectivity } from './adapters/kling-adapter';
import {
  generateWithMiniMaxVideo,
  testMiniMaxVideoConnectivity,
} from './adapters/minimax-video-adapter';
import { generateWithGrokVideo, testGrokVideoConnectivity } from './adapters/grok-video-adapter';
import { generateWithHappyHorse, testHappyHorseConnectivity } from './adapters/happyhorse-adapter';
import {
  generateWithOpenRouterVideo,
  testOpenRouterVideoConnectivity,
} from './adapters/openrouter-video-adapter';
import {
  OPENROUTER_DEFAULT_BASE_URL,
  openRouterBaseUrl,
} from './adapters/openrouter-image-adapter';

import { VIDEO_PROVIDERS } from './video-catalog';
export { VIDEO_PROVIDERS } from './video-catalog';

export async function testVideoConnectivity(
  config: VideoGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  switch (config.providerId) {
    case 'seedance':
      return testSeedanceConnectivity(config);
    case 'kling':
      return testKlingConnectivity(config);
    case 'minimax-video':
      return testMiniMaxVideoConnectivity(config);
    case 'grok-video':
      return testGrokVideoConnectivity(config);
    case 'happyhorse':
      return testHappyHorseConnectivity(config);
    case 'openrouter-video':
      return testOpenRouterVideoConnectivity(config);
    default:
      return {
        success: false,
        message: `Unsupported video provider: ${config.providerId}`,
      };
  }
}

/**
 * Normalize video generation options against provider capabilities.
 * Ensures duration, aspectRatio, and resolution are valid for the given provider.
 * Falls back to the first supported value when the requested value is unsupported.
 */
export function normalizeVideoOptions(
  providerId: VideoProviderId,
  options: VideoGenerationOptions,
): VideoGenerationOptions {
  const provider = VIDEO_PROVIDERS[providerId];
  if (!provider) return options;

  const normalized = { ...options };

  // Duration: use first supported value if unset or unsupported
  if (provider.supportedDurations && provider.supportedDurations.length > 0) {
    if (!normalized.duration || !provider.supportedDurations.includes(normalized.duration)) {
      normalized.duration = provider.supportedDurations[0];
    }
  }

  // Aspect ratio: use first supported value if unset or unsupported
  if (provider.supportedAspectRatios && provider.supportedAspectRatios.length > 0) {
    if (
      !normalized.aspectRatio ||
      !provider.supportedAspectRatios.includes(normalized.aspectRatio)
    ) {
      normalized.aspectRatio = provider
        .supportedAspectRatios[0] as VideoGenerationOptions['aspectRatio'];
    }
  }

  // Resolution: use first supported value if unset or unsupported
  if (provider.supportedResolutions && provider.supportedResolutions.length > 0) {
    if (!normalized.resolution || !provider.supportedResolutions.includes(normalized.resolution)) {
      normalized.resolution = provider.supportedResolutions[0];
    }
  }

  return normalized;
}

/**
 * The endpoint a provider's video tasks live on, as its adapter reaches it
 * from a configured base URL: the provider's default when none is set, with
 * the adapter's own normalization and without trailing slashes. Two base
 * URLs with the same endpoint reach the same tasks.
 */
export function videoTaskEndpoint(providerId: VideoProviderId, baseUrl?: string): string {
  const root =
    providerId === 'seedance'
      ? seedanceApiRoot(baseUrl)
      : providerId === 'openrouter-video'
        ? openRouterBaseUrl(baseUrl)
        : baseUrl || VIDEO_PROVIDERS[providerId]?.defaultBaseUrl || '';
  return root.replace(/\/+$/, '');
}

/**
 * Generate a video: submit the provider task and wait for it. `control`
 * learns the provider's task id before the wait, or resumes the wait on a
 * task submitted earlier.
 */
export async function generateVideo(
  config: VideoGenerationConfig,
  options: VideoGenerationOptions,
  control?: PolledTaskControl,
): Promise<VideoGenerationResult> {
  switch (config.providerId) {
    case 'seedance':
      return generateWithSeedance(config, options, control);
    case 'kling':
      return generateWithKling(config, options, control);
    case 'minimax-video':
      return generateWithMiniMaxVideo(config, options, control);
    case 'grok-video':
      return generateWithGrokVideo(config, options, control);
    case 'happyhorse':
      return generateWithHappyHorse(config, options, control);
    case 'openrouter-video':
      return generateWithOpenRouterVideo(config, options, control);
    default:
      throw new Error(`Unsupported video provider: ${config.providerId}`);
  }
}
