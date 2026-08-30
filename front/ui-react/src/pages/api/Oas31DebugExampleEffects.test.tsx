import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { OperationDebugModel } from 'knife4j-core';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import type { SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import type {
  GenerateOas31DebugBodyExamplesOptions,
  Oas31DebugBodyExamples,
  Oas31DebugExampleIdentity,
  Oas31DebugExampleState,
} from './oas31DebugExamples';

type Effect = () => void | (() => void);

const reactHarness = vi.hoisted(() => ({ effects: [] as Effect[] }));

vi.mock('react', () => ({
  useEffect: (effect: Effect) => reactHarness.effects.push(effect),
}));

import { Oas31DebugDefaultHydrator, Oas31DebugExampleLoader } from './Oas31DebugExampleEffects';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const document: SwaggerDoc = {
  openapi: '3.1.1',
  info: { title: 'Effects', version: '1.0.0' },
  paths: {},
};

const operation: MenuOperation = {
  key: 'Pets/post',
  path: '/pets',
  method: 'post',
  summary: 'Create pet',
  operation: { responses: { 204: { description: 'created' } } },
  source: 'path',
};

const debugModel: OperationDebugModel = {
  pathParams: [],
  queryParams: [],
  headerParams: [],
  cookieParams: [],
  bodyContents: [
    {
      mediaType: 'application/json',
      category: 'json',
      schema: { type: 'object' },
    },
  ],
  bodyRequired: true,
};

const examples: Oas31DebugBodyExamples = {
  defaults: {
    bodyByMediaType: { 'application/json': '{\n  "name": "generated"\n}' },
    formFieldsByMediaType: { 'application/json': {} },
  },
  resultByMediaType: {},
};

const firstIdentity: Oas31DebugExampleIdentity = {
  retrievalUri: 'https://examples.knife4j.example/first.json',
  operationKey: 'Pets/post',
};

const secondIdentity: Oas31DebugExampleIdentity = {
  retrievalUri: 'https://examples.knife4j.example/second.json',
  operationKey: 'Pets/put',
};

const session = {
  retrievalUri: firstIdentity.retrievalUri,
  resolve: vi.fn(),
  evaluate: vi.fn(),
  dispose: vi.fn(),
} as unknown as SchemaDocumentSession;

beforeEach(() => {
  reactHarness.effects.length = 0;
  vi.clearAllMocks();
});

describe('OAS 3.1 debug example effect components', () => {
  test('aborts the previous operation or group task and ignores its late result', async () => {
    const first = deferred<Oas31DebugBodyExamples>();
    const second = deferred<Oas31DebugBodyExamples>();
    const firstGenerator = vi.fn(
      (
        _document: SwaggerDoc,
        _operation: MenuOperation,
        _model: OperationDebugModel,
        _session: SchemaDocumentSession,
        options: GenerateOas31DebugBodyExamplesOptions,
      ) => {
        expect(options.signal?.aborted).toBe(false);
        return first.promise;
      },
    );
    const secondGenerator = vi.fn(() => second.promise);
    const setState = vi.fn();

    Oas31DebugExampleLoader({
      enabled: true,
      document,
      operation,
      debugModel,
      session,
      identity: firstIdentity,
      setState,
      generateExamples: firstGenerator,
    });
    const cleanup = reactHarness.effects[0]?.();
    expect(setState).toHaveBeenLastCalledWith({ status: 'loading', identity: firstIdentity });
    expect(cleanup).toBeTypeOf('function');

    if (typeof cleanup === 'function') cleanup();
    first.resolve(examples);
    await first.promise;
    await Promise.resolve();
    expect(setState).toHaveBeenCalledTimes(1);

    reactHarness.effects.length = 0;
    Oas31DebugExampleLoader({
      enabled: true,
      document,
      operation: { ...operation, key: 'Pets/put' },
      debugModel,
      session,
      identity: secondIdentity,
      setState,
      generateExamples: secondGenerator,
    });
    reactHarness.effects[0]?.();
    second.resolve(examples);
    await second.promise;
    await Promise.resolve();

    expect(setState).toHaveBeenLastCalledWith({ status: 'ready', identity: secondIdentity, examples });
  });

  test('does not overwrite user edits or stale identities and applies a current result only once', () => {
    const ready: Oas31DebugExampleState = { status: 'ready', identity: firstIdentity, examples };
    const editRevisionRef = { current: 1 };
    const appliedIdentityRef: { current: Oas31DebugExampleIdentity | null } = { current: null };
    const setBody = vi.fn();
    const setFormFields = vi.fn();
    const base = {
      activeExamples: examples,
      state: ready,
      editRevisionRef,
      appliedIdentityRef,
      hydratedDebugCacheKey: 'first-cache',
      currentDebugCacheKey: 'first-cache',
      selectedBody: debugModel.bodyContents[0],
      setBody,
      setFormFields,
    };

    Oas31DebugDefaultHydrator({ ...base, identity: firstIdentity });
    reactHarness.effects[0]?.();
    expect(setBody).not.toHaveBeenCalled();

    editRevisionRef.current = 0;
    reactHarness.effects.length = 0;
    Oas31DebugDefaultHydrator({ ...base, activeExamples: null, identity: secondIdentity });
    reactHarness.effects[0]?.();
    expect(setBody).not.toHaveBeenCalled();

    reactHarness.effects.length = 0;
    Oas31DebugDefaultHydrator({ ...base, identity: firstIdentity });
    reactHarness.effects[0]?.();
    expect(setBody).toHaveBeenCalledWith('{\n  "name": "generated"\n}');
    expect(setFormFields).toHaveBeenCalledWith({});
    expect(appliedIdentityRef.current).toEqual(firstIdentity);

    reactHarness.effects.length = 0;
    Oas31DebugDefaultHydrator({ ...base, identity: firstIdentity });
    reactHarness.effects[0]?.();
    expect(setBody).toHaveBeenCalledTimes(1);
  });
});
