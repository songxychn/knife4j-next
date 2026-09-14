import { describe, expect, it, vi } from 'vitest';
import { collectOas32DocumentDiagnostics } from 'knife4j-core';
import { resolveHomeServers } from './homeServerInfo';
import type { SwaggerDoc } from '../types/swagger';

const { jsxFactory } = vi.hoisted(() => ({
  jsxFactory: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
}));
vi.mock('react/jsx-runtime', () => ({ jsx: jsxFactory, jsxs: jsxFactory, jsxDEV: jsxFactory }));
vi.mock('react/jsx-dev-runtime', () => ({ jsxDEV: jsxFactory }));
vi.mock('antd', () => ({
  Alert: 'Alert',
  Collapse: 'Collapse',
  Space: 'Space',
  Typography: { Text: 'Text', Paragraph: 'Paragraph' },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import HomeServerSummary from './HomeServerSummary';
import Oas32ServerDetails from '../components/Oas32ServerDetails';

interface Element {
  type: unknown;
  props: Record<string, unknown>;
}
// Only walk rendered children: collapsed panels' item descriptors are not visible content.
function visibleText(value: unknown): string {
  if (Array.isArray(value)) return value.map(visibleText).join(' ');
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || !('props' in value)) return '';
  const { type, props } = value as Element;
  if (type === 'Alert') return `${visibleText(props.message)} ${visibleText(props.description)}`;
  return visibleText(props.children);
}
const doc: SwaggerDoc = {
  openapi: '3.2.0',
  info: { title: 'Server summary', version: '1' },
  paths: {},
  servers: [
    { name: 'ext', url: 'useHttpAddr', description: 'Relative server' },
    { name: 'staging', url: 'https://staging.example.com:10018/very-long-service-prefix/extension/api' },
  ],
};
const retrieval = 'https://docs.example.com/openapi/entry.json';

describe('homepage OAS 3.2 server summary', () => {
  it('shows final URLs and descriptions without the resolution trace for valid servers', () => {
    expect(collectOas32DocumentDiagnostics(doc)).toEqual([]);
    const servers = resolveHomeServers(doc, 'https://ui.example.com', retrieval);
    expect(servers).toHaveLength(2);
    const summaries = servers.map((s) => visibleText(HomeServerSummary({ server: s.resolution! })));
    expect(summaries[0]).toContain('ext');
    expect(summaries[0]).toContain('https://docs.example.com/openapi/useHttpAddr');
    expect(summaries[0]).toContain('Relative server');
    expect(summaries[1]).toContain(doc.servers![1].url);
    expect(summaries.join(' ')).not.toContain('oas32.server.owner');
    expect(summaries.join(' ')).not.toContain('oas32.server.raw');
  });

  it('keeps diagnostics visible and never presents an unresolved template as a usable URL', () => {
    const [server] = resolveHomeServers({ ...doc, servers: [{ url: 'https://{host}/api' }] }, undefined, retrieval);
    expect(server.resolution!.diagnostics.length).toBeGreaterThan(0);
    const summary = visibleText(HomeServerSummary({ server: server.resolution! }));
    expect(summary).toContain('oas32.server.unavailable');
    for (const diagnostic of server.resolution!.diagnostics) {
      expect(summary).toContain(diagnostic.code);
      expect(summary).toContain(diagnostic.reason);
    }
    // The shared debug details retain diagnostics by default; homepage renders them outside the fold.
    expect(visibleText(Oas32ServerDetails({ server: server.resolution! }))).toContain(
      server.resolution!.diagnostics[0].reason,
    );
    expect(visibleText(Oas32ServerDetails({ server: server.resolution!, showDiagnostics: false }))).not.toContain(
      server.resolution!.diagnostics[0].reason,
    );
  });
});
