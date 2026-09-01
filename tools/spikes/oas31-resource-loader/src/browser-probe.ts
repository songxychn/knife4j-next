import {
  fetchExternalResource,
  normalizeExternalResourceUri,
  type FetchedExternalResource,
  type ResourceLoadErrorCode,
} from '../../../../front/ui-react/src/schema/externalResourcePolicy';
import { ExternalResourceLoader } from '../../../../front/ui-react/src/schema/externalResourceGraph';
import { loadProbeSchemaGraph } from './resource-policy';

interface AssertionResult {
  name: string;
  passed: boolean;
  detail: string;
}

interface ProbeConfig {
  allowedOrigin: string;
  noCorsOrigin: string;
  cspBlockedOrigin: string;
}

const moduleUrl = new URL(import.meta.url);
const config: ProbeConfig = {
  allowedOrigin: moduleUrl.searchParams.get('allowedOrigin') ?? '',
  noCorsOrigin: moduleUrl.searchParams.get('noCorsOrigin') ?? '',
  cspBlockedOrigin: moduleUrl.searchParams.get('cspBlockedOrigin') ?? '',
};
const pageUri = location.href;
const assertions: AssertionResult[] = [];

const addAssertion = (name: string, passed: boolean, detail: string): void => {
  assertions.push({ name, passed, detail });
};

const exactGrant = (uri: string): Set<string> =>
  new Set([normalizeExternalResourceUri(uri, pageUri, pageUri)]);

const fetchOne = (
  uri: string,
  options: { maxBytes?: number; signal?: AbortSignal; grants?: ReadonlySet<string> } = {},
): Promise<FetchedExternalResource> =>
  fetchExternalResource(uri, pageUri, {
    pageUri,
    authorizedUris: options.grants ?? exactGrant(uri),
    maxBytes: options.maxBytes ?? 4096,
    timeoutMs: 2000,
    signal: options.signal,
  });

const expectError = async (
  name: string,
  expectedCode: ResourceLoadErrorCode,
  operation: () => Promise<unknown>,
): Promise<void> => {
  try {
    await operation();
    addAssertion(name, false, `expected ${expectedCode}, request unexpectedly succeeded`);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : error instanceof Error ? error.name : '';
    addAssertion(name, code === expectedCode, `observed ${code || 'unknown error'}`);
  }
};

const run = async (): Promise<Record<string, unknown>> => {
  const browserCookiePresent = document.cookie.split(';').some((item) => item.trim().startsWith('knife4j_probe='));
  const credentials = await fetchOne(`${location.origin}/credential-check.json`);
  const observedCredentials = JSON.parse(credentials.text) as Record<string, unknown>;
  const responseCookieStored = document.cookie
    .split(';')
    .some((item) => item.trim().startsWith('knife4j_resource_response='));
  addAssertion(
    'request and response credentials plus referrer are omitted even for same-origin resources',
    browserCookiePresent &&
      observedCredentials.cookie === false &&
      observedCredentials.authorization === false &&
      observedCredentials.referer === false &&
      responseCookieStored === false,
    JSON.stringify({ browserCookiePresent, responseCookieStored, ...observedCredentials }),
  );

  const cors = await fetchOne(`${config.allowedOrigin}/cors-ok.json`);
  const observedCors = JSON.parse(cors.text) as Record<string, unknown>;
  addAssertion(
    'an explicitly allowed cross-origin resource still requires CORS',
    observedCors.origin === location.origin &&
      observedCors.cookie === false &&
      observedCors.authorization === false &&
      observedCors.referer === false,
    JSON.stringify(observedCors),
  );

  await expectError('a missing CORS grant is surfaced as an opaque fetch failure', 'RESOURCE_FETCH_BLOCKED', () =>
    fetchOne(`${config.noCorsOrigin}/cors-blocked.json`),
  );
  await expectError('page CSP remains authoritative after product authorization', 'RESOURCE_FETCH_BLOCKED', () =>
    fetchOne(`${config.cspBlockedOrigin}/csp-blocked.json`),
  );
  await expectError('redirects are rejected before a second target is fetched', 'RESOURCE_FETCH_BLOCKED', () =>
    fetchOne(`${config.allowedOrigin}/redirect.json`),
  );

  const abortController = new AbortController();
  const slow = fetchOne(`${config.allowedOrigin}/slow.json`, { signal: abortController.signal });
  setTimeout(() => abortController.abort(), 30);
  await expectError('AbortSignal cancels an in-flight resource request', 'RESOURCE_ABORTED', () => slow);

  await expectError('decoded response bytes are bounded while streaming', 'RESOURCE_TOO_LARGE', () =>
    fetchOne(`${config.allowedOrigin}/oversize.json`, { maxBytes: 64 }),
  );
  await expectError('unknown content types are rejected without body sniffing', 'RESOURCE_CONTENT_TYPE_UNSUPPORTED', () =>
    fetchOne(`${config.allowedOrigin}/wrong-content-type`),
  );

  const productionGraphUri = `${config.allowedOrigin}/production-graph.json?token=browser-secret`;
  const productionUngrantedUri = `${config.allowedOrigin}/production-ungranted.json`;
  const productionLoader = new ExternalResourceLoader(
    {
      openapi: '3.1.1',
      info: { title: 'Production graph browser probe', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          Authorized: { $ref: `${productionGraphUri}#/$defs/Authorized` },
          Ungranted: { $ref: productionUngrantedUri },
        },
      },
    },
    `${location.origin}/entry.json`,
    { pageUri },
  );
  const productionDiscovery = productionLoader.discover();
  const productionCandidate = productionDiscovery.candidates.find(
    (candidate) => candidate.retrievalUri === productionGraphUri,
  );
  const productionSnapshot = productionCandidate
    ? await productionLoader.load([
        {
          scope: 'generation',
          documentScope: productionLoader.documentScope,
          resourceKey: productionCandidate.retrievalUriHash,
        },
      ])
    : productionLoader.currentSnapshot();
  const remainingProductionCandidates = productionLoader.currentDiscovery().candidates;
  addAssertion(
    'the production graph loader fetches only the exact selected resource and keeps other references pending',
    productionDiscovery.candidates.length === 2 &&
      productionCandidate?.displayUri.includes('browser-secret') === false &&
      productionSnapshot.nodes.has(productionGraphUri) &&
      !productionSnapshot.nodes.has(productionUngrantedUri) &&
      remainingProductionCandidates.length === 1 &&
      remainingProductionCandidates[0]?.retrievalUri === productionUngrantedUri,
    JSON.stringify({
      discovered: productionDiscovery.candidates.length,
      nodes: productionSnapshot.nodes.size,
      remaining: remainingProductionCandidates.map((candidate) => candidate.displayUri),
    }),
  );
  productionLoader.dispose();

  const cycleA = `${config.allowedOrigin}/cycle-a.json`;
  const cycleB = `${config.allowedOrigin}/cycle-b.json`;
  const cycleGrants = new Set([
    normalizeExternalResourceUri(cycleA, pageUri, pageUri),
    normalizeExternalResourceUri(cycleB, pageUri, pageUri),
  ]);
  const cycleGraph = await loadProbeSchemaGraph(
    cycleA,
    (uri) => fetchOne(uri, { grants: cycleGrants }),
    { maxResources: 4, maxReferences: 8, maxDepth: 4 },
    pageUri,
  );
  addAssertion(
    'external reference cycles terminate and each document is fetched once',
    cycleGraph.documents.size === 2 && cycleGraph.references === 2 && cycleGraph.cycles.length === 1,
    JSON.stringify({
      documents: cycleGraph.documents.size,
      references: cycleGraph.references,
      cycles: cycleGraph.cycles.length,
    }),
  );

  const budgetA = `${config.allowedOrigin}/budget-a.json`;
  const budgetB = `${config.allowedOrigin}/budget-b.json`;
  const budgetGrants = new Set([
    normalizeExternalResourceUri(budgetA, pageUri, pageUri),
    normalizeExternalResourceUri(budgetB, pageUri, pageUri),
  ]);
  await expectError('resource count is checked before fetching the next graph node', 'GRAPH_RESOURCE_LIMIT', () =>
    loadProbeSchemaGraph(
      budgetA,
      (uri) => fetchOne(uri, { grants: budgetGrants }),
      { maxResources: 1, maxReferences: 8, maxDepth: 4 },
      pageUri,
    ),
  );

  return {
    allPassed: assertions.every((assertion) => assertion.passed),
    assertions,
    browserPolicy: {
      mode: 'cors',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    },
  };
};

try {
  const result = await run();
  document.querySelector('output')!.textContent = JSON.stringify(result);
  document.body.dataset.status = result.allPassed === true ? 'passed' : 'failed';
} catch (error) {
  document.querySelector('output')!.textContent = JSON.stringify({
    allPassed: false,
    assertions,
    fatal: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  });
  document.body.dataset.status = 'failed';
}
