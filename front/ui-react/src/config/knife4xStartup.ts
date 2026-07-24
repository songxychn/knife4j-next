import {
  fetchSwaggerDocResult,
  fetchSwaggerUiConfig,
  isOpenApi3Document,
  parseGroupsFromConfig,
  type LanguageAwareRequestOptions,
  type SwaggerDocFetchResult,
} from '../api/knife4jClient';
import { fetchWithAcceptLanguage } from '../api/acceptLanguage';
import type { SwaggerGroup, SwaggerUiConfig } from '../types/swagger';
import type { Knife4xBootstrap } from './knife4xConfig';

export type InitialGroupsResult =
  | { mode: 'ready'; groups: SwaggerGroup[]; swaggerUiConfig: SwaggerUiConfig | null }
  | { mode: 'error'; error: string }
  | { mode: 'mock' };

export async function loadInitialGroups(
  bootstrap: Knife4xBootstrap,
  preferredLanguage?: string,
): Promise<InitialGroupsResult> {
  if (bootstrap.mode === 'error') {
    return bootstrap;
  }

  if (bootstrap.mode === 'embed') {
    return {
      mode: 'ready',
      groups: [{ name: 'default', url: bootstrap.config.specUrl }],
      swaggerUiConfig: null,
    };
  }

  const swaggerUiConfig = await fetchSwaggerUiConfig({ preferredLanguage });
  if (swaggerUiConfig) {
    return {
      mode: 'ready',
      groups: parseGroupsFromConfig(swaggerUiConfig),
      swaggerUiConfig,
    };
  }

  try {
    const response = await fetchWithAcceptLanguage('swagger-resources', preferredLanguage);
    if (response.ok) {
      const resources: Array<{ name: string; location: string; swaggerVersion?: string }> = await response.json();
      if (resources.length > 0) {
        return {
          mode: 'ready',
          groups: resources.map((group) => ({
            name: group.name,
            url: group.location,
            location: group.location,
            swaggerVersion: group.swaggerVersion,
          })),
          swaggerUiConfig: null,
        };
      }
    }
  } catch {
    // Java discovery 失败时保持现有 mock fallback。
  }

  return { mode: 'mock' };
}

export async function fetchSwaggerDocForMode(
  url: string,
  mode: 'java' | 'embed',
  options: LanguageAwareRequestOptions = {},
): Promise<SwaggerDocFetchResult> {
  const result = await fetchSwaggerDocResult(url, options);
  if (mode === 'embed' && result.doc && !isOpenApi3Document(result.doc)) {
    return { doc: null, error: 'Knife4x 仅支持 OpenAPI 3.x 文档。' };
  }
  return result;
}
