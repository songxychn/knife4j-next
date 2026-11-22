import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectOas32DocumentDiagnostics } from 'knife4j-core';
import { resolveHomeServers } from './homeServerInfo';
import type { SwaggerDoc } from '../types/swagger';

import { createReactTestRoot } from '../test/reactTestRoot';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import HomeServerSummary from './HomeServerSummary';
import Oas32ServerDetails from '../components/Oas32ServerDetails';

let view: ReturnType<typeof createReactTestRoot>;
beforeEach(() => {
  view = createReactTestRoot();
});
afterEach(async () => {
  await view.unmount();
});

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
  it('shows final URLs and descriptions without the resolution trace for valid servers', async () => {
    expect(collectOas32DocumentDiagnostics(doc)).toEqual([]);
    const servers = resolveHomeServers(doc, 'https://ui.example.com', retrieval);
    expect(servers).toHaveLength(2);
    await view.render(
      <>
        {servers.map((server, index) => (
          <HomeServerSummary key={index} server={server.resolution!} />
        ))}
      </>,
    );
    const summaries = [...view.container.querySelectorAll('.knife4j-home-server')].map((node) => node.textContent);
    expect(summaries[0]).toContain('ext');
    expect(summaries[0]).toContain('https://docs.example.com/openapi/useHttpAddr');
    expect(summaries[0]).toContain('Relative server');
    expect(summaries[1]).toContain(doc.servers![1].url);
    expect(summaries.join(' ')).not.toContain('oas32.server.owner');
    expect(summaries.join(' ')).not.toContain('oas32.server.raw');
  });

  it('keeps diagnostics visible and never presents an unresolved template as a usable URL', async () => {
    const [server] = resolveHomeServers({ ...doc, servers: [{ url: 'https://{host}/api' }] }, undefined, retrieval);
    expect(server.resolution!.diagnostics.length).toBeGreaterThan(0);
    await view.render(<HomeServerSummary server={server.resolution!} />);
    const summary = view.container.textContent;
    expect(summary).toContain('oas32.server.unavailable');
    for (const diagnostic of server.resolution!.diagnostics) {
      expect(summary).toContain(diagnostic.code);
      expect(summary).toContain(diagnostic.reason);
    }
    // The shared debug details retain diagnostics by default; homepage renders them outside the fold.
    await view.render(<Oas32ServerDetails server={server.resolution!} />);
    expect(view.container.textContent).toContain(server.resolution!.diagnostics[0].reason);
    await view.render(<Oas32ServerDetails server={server.resolution!} showDiagnostics={false} />);
    expect(view.container.textContent).not.toContain(server.resolution!.diagnostics[0].reason);
  });
});
