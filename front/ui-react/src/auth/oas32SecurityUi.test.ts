import { describe, expect, test, vi } from 'vitest';
import { collectOas32DocumentDiagnostics, type SchemeValue } from 'knife4j-core';
import { ExternalResourceLoader } from '../schema/externalResourceGraph';
import { enumerateRegistryOperations } from '../schema/operationRegistry';
import type { SwaggerDoc } from '../types/swagger';
import { projectOas32Security } from './oas32Security';
import {
  authorizeSchemeCards,
  debugAuthFromOas32Plan,
  projectAndPlanOas32Security,
  resolveOas32OauthEndpoint,
} from './oas32SecurityUi';

const entry = 'https://docs.example.test/entry.json';
const document32 = (extra: Record<string, unknown> = {}) => ({
  openapi: '3.2.0',
  info: { title: 'Synthetic security UI', version: '1' },
  servers: [{ url: 'https://api.example.test/v1' }],
  paths: { '/sample': { get: { responses: { '200': { description: 'OK' } } } } },
  ...extra,
});

function fixture(extra: Record<string, unknown> = {}) {
  const document = document32(extra);
  expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
  const loader = new ExternalResourceLoader(document, entry, { fetchImpl: vi.fn() });
  const snapshot = loader.currentSnapshot();
  const { operations } = enumerateRegistryOperations(document as SwaggerDoc, entry, snapshot);
  return {
    snapshot,
    operation: { identity: operations[0], path: '/sample', method: 'GET', key: 'get', summary: '', operation: {} },
  };
}

describe('resolveOas32OauthEndpoint', () => {
  test('keeps an absolute HTTPS endpoint', () => {
    expect(resolveOas32OauthEndpoint('https://auth.example.test/device', undefined)).toEqual({
      href: 'https://auth.example.test/device',
    });
  });

  test('rejects userinfo and fragments', () => {
    expect(resolveOas32OauthEndpoint('https://user:pass@auth.example.test/device', undefined)).toEqual({
      issue: 'invalid',
    });
    expect(resolveOas32OauthEndpoint('https://auth.example.test/device#frag', undefined)).toEqual({ issue: 'invalid' });
  });

  test('does not guess a relative endpoint without an API base', () => {
    expect(resolveOas32OauthEndpoint('/device', undefined)).toEqual({ issue: 'relative-without-base' });
    expect(resolveOas32OauthEndpoint('/device', 'https://api.example.test/v1/')).toEqual({
      href: 'https://api.example.test/device',
    });
  });
});

describe('authorizeSchemeCards and debug injection', () => {
  test('lists named catalog schemes with their credential keys', () => {
    const { snapshot } = fixture({
      components: { securitySchemes: { Named: { type: 'http', scheme: 'bearer' } } },
      security: [{ Named: [] }],
    });
    const projection = projectOas32Security(snapshot);
    const cards = authorizeSchemeCards(projection);
    expect(cards).toEqual([
      expect.objectContaining({
        name: 'Named',
        credentialKey: 'Named',
        scheme: expect.objectContaining({ type: 'http' }),
      }),
    ]);
  });

  test('empty 3.2 security injects no automatic credentials, including leftover schemes', () => {
    const { snapshot, operation } = fixture({
      components: { securitySchemes: { Named: { type: 'http', scheme: 'bearer' } } },
      security: [],
    });
    const credentials = {
      bySecurityKey: { Named: { type: 'http', scheme: 'bearer', token: 'leftover' } as SchemeValue },
      bearerToken: 'legacy',
    };
    const result = projectAndPlanOas32Security(snapshot, operation, credentials);
    expect(result?.projection.declaration).toBe('empty');
    expect(debugAuthFromOas32Plan(result?.plan)).toEqual({ auth: { bySecurityKey: {} }, securityKeys: [] });
  });

  test('selects only the first complete OR branch and ignores other saved schemes', () => {
    const { snapshot, operation } = fixture({
      components: {
        securitySchemes: {
          A: { type: 'http', scheme: 'bearer' },
          B: { type: 'apiKey', in: 'query', name: 'api_key' },
        },
      },
      security: [{ A: [] }, { B: [] }],
    });
    const credentials = {
      bySecurityKey: {
        A: { type: 'http', scheme: 'bearer', token: 'token-a' } as SchemeValue,
        B: { type: 'apiKey', in: 'query', name: 'api_key', value: 'key-b' } as SchemeValue,
      },
    };
    const result = projectAndPlanOas32Security(snapshot, operation, credentials);
    expect(debugAuthFromOas32Plan(result?.plan)).toEqual({
      auth: { bySecurityKey: { A: { type: 'http', scheme: 'bearer', token: 'token-a' } } },
      securityKeys: ['A'],
    });
    const second = projectAndPlanOas32Security(snapshot, operation, credentials, 1);
    expect(debugAuthFromOas32Plan(second?.plan).securityKeys).toEqual(['B']);
  });
});
