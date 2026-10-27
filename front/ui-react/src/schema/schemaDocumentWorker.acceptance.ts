/** Local browser acceptance entry; not imported by the application. */
import { openApi32SchemaRegistrationContext } from 'knife4j-schema-engine';
import type { JsonValue } from 'knife4j-schema-engine';
import type { SwaggerDoc } from '../types/swagger';
import { createWorkerSchemaDocumentSession, SchemaDocumentWorkerRuntime } from './schemaDocumentWorkerClient';
import { registeredSchemaDocument, type SchemaDocumentSession } from './schemaDocumentSession';
import { generateSchemaExample, type SchemaExampleResult } from './schemaExampleGeneration';

const reference = '#/components/schemas/Value';
const retrievalUri = 'https://acceptance.knife4j.example/openapi.json';
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function documentFor(schema: JsonValue, openapi = '3.1.1', extra: Record<string, JsonValue> = {}): SwaggerDoc {
  return {
    openapi,
    info: { title: 'Worker acceptance', version: '1' },
    paths: {},
    components: { schemas: { Value: schema, ...extra } },
  } as SwaggerDoc;
}
function validValue(result: SchemaExampleResult): JsonValue {
  assert(result.status === 'value' && result.validation === 'valid', JSON.stringify(result));
  return result.value;
}
function failure(error: unknown): { name: string; message: string; code?: unknown } {
  const value = error as Error & { code?: unknown };
  return { name: value?.name ?? 'Error', message: value?.message ?? String(error), code: value?.code };
}

export function createWorkerAcceptance(workerUrl: string) {
  const longTasks: PerformanceEntry[] = [];
  const longTaskObserver = PerformanceObserver.supportedEntryTypes.includes('longtask')
    ? new PerformanceObserver((list) => longTasks.push(...list.getEntries()))
    : undefined;
  longTaskObserver?.observe({ type: 'longtask' });
  const workerRuntime = new SchemaDocumentWorkerRuntime(() => new Worker(workerUrl, { type: 'module' }));
  const runtime = () => workerRuntime;
  async function open(schema: JsonValue, openapi = '3.1.1', extra: Record<string, JsonValue> = {}) {
    return createWorkerSchemaDocumentSession(documentFor(schema, openapi, extra), retrievalUri, { runtime: runtime() });
  }
  async function ordinary() {
    const cases = [];
    for (const version of ['3.1.1', '3.2.0']) {
      for (const required of [0, 700, 1000]) {
        const names = Array.from({ length: 1000 }, (_, i) => `field${i}`);
        const session = await open(
          {
            type: 'object',
            properties: Object.fromEntries(names.map((name) => [name, { type: 'string' }])),
            required: names.slice(0, required),
            additionalProperties: false,
          },
          version,
        );
        try {
          assert(registeredSchemaDocument(session, retrievalUri), 'main-thread registry lost its immutable document');
          for (const direction of ['request', 'response'] as const) {
            const started = performance.now();
            const result = await generateSchemaExample(session, reference, { direction });
            const value = validValue(result);
            assert(value && Object.keys(value).length === 1000, 'ordinary object lost applicable fields');
            assert(
              (await session.evaluate(reference, value)).valid,
              'generated object failed independent raw evaluation',
            );
            cases.push({ version, required, direction, fields: 1000, elapsedMs: performance.now() - started });
          }
          // UI consumers issue independent operations concurrently: all must finish, in FIFO order.
          const concurrent = await Promise.all([
            session.resolve(reference),
            session.evaluate(reference, Object.fromEntries(names.map((name) => [name, '']))),
            generateSchemaExample(session, reference, { direction: 'request' }),
          ]);
          assert(concurrent[1].valid && concurrent[2].status === 'value', 'concurrent RPCs cancelled one another');
        } finally {
          session.dispose();
        }
      }
    }
    return cases;
  }
  async function scopeAndGraph() {
    const external = 'https://acceptance.knife4j.example/external';
    const externalDocument = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'integer' } },
      additionalProperties: false,
    };
    const schemas: Record<string, JsonValue> = {
      Code: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: 'https://acceptance.knife4j.example/code',
        $anchor: 'code',
        type: 'string',
        const: 'ABC',
      },
      Slot: { $id: 'https://acceptance.knife4j.example/slot', $dynamicAnchor: 'slot', type: 'string' },
      Template: {
        $id: 'https://acceptance.knife4j.example/template',
        type: 'object',
        required: ['value'],
        properties: { value: { $dynamicRef: 'https://acceptance.knife4j.example/slot#slot' } },
        additionalProperties: false,
      },
      Override: {
        $id: 'https://acceptance.knife4j.example/override',
        $ref: 'https://acceptance.knife4j.example/template',
        $defs: { Slot: { $dynamicAnchor: 'slot', type: 'string', readOnly: true } },
      },
      External: { $ref: external },
    };
    const evidence = [];
    for (const version of ['3.1.1', '3.2.0']) {
      const document = documentFor({ $ref: 'https://acceptance.knife4j.example/code#code' }, version, schemas);
      const session = await createWorkerSchemaDocumentSession(document, retrievalUri, {
        runtime: runtime(),
        ...(version === '3.2.0'
          ? {
              registrationContext: {
                openapi32: true as const,
                schemaLocations: Object.entries(document.components?.schemas ?? {}).flatMap(([name, schema]) =>
                  openApi32SchemaRegistrationContext(schema, retrievalUri).schemaLocations.map((location) => ({
                    ...location,
                    pointer: `#/components/schemas/${name}${location.pointer.slice(1)}`,
                  })),
                ),
              },
            }
          : {}),
        resourceDocuments: [
          {
            retrievalUri: external,
            document: externalDocument,
            ...(version === '3.2.0' ? { context: openApi32SchemaRegistrationContext(externalDocument, external) } : {}),
          },
        ],
      });
      try {
        assert(
          validValue(await generateSchemaExample(session, reference, { direction: 'request' })) === 'ABC',
          'id/anchor scope lost',
        );
        const dynamic = [];
        for (const direction of ['request', 'response'] as const) {
          const value = validValue(
            await generateSchemaExample(session, '#/components/schemas/Override', { direction }),
          );
          assert(
            JSON.stringify(value) === (direction === 'request' ? '{}' : '{"value":""}'),
            'dynamic scope/direction lost',
          );
          dynamic.push({ direction, value });
        }
        const rawExternal = await session
          .evaluate('#/components/schemas/External', { id: 0 })
          .catch((error: unknown) => {
            throw new Error(`raw external graph failed (${version}): ${JSON.stringify(failure(error))}`);
          });
        assert(rawExternal.valid, `raw external graph failed (${version}): ${JSON.stringify(rawExternal)}`);
        const externalResult = await generateSchemaExample(session, '#/components/schemas/External', {
          direction: 'request',
        });
        assert(
          externalResult.status === 'value' && externalResult.validation === 'valid',
          `external generation failed (${version}), raw evaluation valid: ${JSON.stringify(externalResult)}`,
        );
        const externalValue = validValue(externalResult);
        assert(JSON.stringify(externalValue) === '{"id":0}', 'registered resource graph lost');
        assert(registeredSchemaDocument(session, external), 'main-thread external registry lost');
        evidence.push({ version, anchors: 'ABC', dynamic, externalValue });
      } finally {
        session.dispose();
      }
    }
    const session = await open({ type: 'integer' });
    try {
      const explicit = await generateSchemaExample(session, reference, {
        direction: 'request',
        explicit: [{ source: 'media-example', value: 'authored-invalid-value' }],
      });
      assert(
        explicit.status === 'value' &&
          explicit.value === 'authored-invalid-value' &&
          explicit.authored &&
          explicit.validation === 'invalid' &&
          explicit.diagnostics.some((item) => item.code === 'EXPLICIT_VALUE_INVALID'),
        'authored invalid media value was changed or hidden',
      );
      return { evidence, explicit };
    } finally {
      session.dispose();
    }
  }
  type InterruptionMode =
    'abort' | 'timeout' | 'timeout-schema-example' | 'timeout-schema-examples' | 'dispose' | 'runtime-dispose';
  let activeSession: SchemaDocumentSession | undefined;
  let activeController: AbortController | undefined;
  let activeTask: Promise<unknown> | undefined;
  let cancellationStarted: number | undefined;
  function startPathological(mode: InterruptionMode) {
    const started = performance.now();
    const isTimeout = mode.startsWith('timeout');
    const fromSchema = mode === 'timeout-schema-example' || mode === 'timeout-schema-examples';
    const authoredValue = `${'a'.repeat(36)}!`;
    const expectedSource =
      mode === 'timeout-schema-example'
        ? 'schema-example'
        : mode === 'timeout-schema-examples'
          ? 'schema-examples'
          : 'media-example';
    cancellationStarted = undefined;
    let ticks = 0;
    let previousTick = started;
    let maxHeartbeatGapMs = 0;
    const heartbeat = setInterval(() => {
      ticks += 1;
      const now = performance.now();
      maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - previousTick);
      previousTick = now;
    }, 10);
    activeController = new AbortController();
    activeTask = (async () => {
      const schema: JsonValue = {
        type: 'string',
        pattern: '^(a+)+$',
        ...(mode === 'timeout-schema-example' ? { example: authoredValue } : {}),
        ...(mode === 'timeout-schema-examples' ? { examples: [authoredValue, 'aaa'], example: 'aaaa' } : {}),
      };
      activeSession = await open(schema);
      const result = await generateSchemaExample(activeSession, reference, {
        direction: 'request',
        ...(fromSchema ? {} : { explicit: [{ source: 'media-example' as const, value: authoredValue }] }),
        signal: activeController?.signal,
      }).then(
        (result) => ({ result }),
        (error: unknown) => ({ failure: failure(error) }),
      );
      const elapsedMs = performance.now() - started;
      assert(ticks >= 2, 'main-thread heartbeat stopped while native regex was running');
      if (!isTimeout) {
        assert(
          'failure' in result && result.failure.name === 'AbortError',
          'cancel/dispose did not reject with AbortError; stale value could write back',
        );
      }
      if ('result' in result) {
        const value = result.result;
        assert(value.status !== 'value' || value.validation !== 'valid', 'stale/failed evaluation became valid');
        assert(value.diagnostics.length > 0, 'failed computation returned no diagnostic');
        if (isTimeout) {
          assert(
            value.status === 'value' &&
              value.authored &&
              value.value === authoredValue &&
              value.source === expectedSource &&
              value.validation === 'unavailable',
            `timeout did not preserve selected ${expectedSource} value`,
          );
        }
      } else {
        assert(result.failure.message.length > 0, 'cancelled task gave no diagnostic');
      }
      if (isTimeout) assert(elapsedMs >= 1800 && elapsedMs < 2500, `default 2s deadline: ${elapsedMs}`);
      activeSession.dispose();
      activeSession = undefined;
      return { mode, elapsedMs, heartbeatTicks: ticks, maxHeartbeatGapMs, ...result };
    })()
      .finally(() => clearInterval(heartbeat))
      .then((evidence) => {
        const settledAt = performance.now();
        return {
          ...evidence,
          cancellationCallbackAtMs: cancellationStarted,
          taskSettledAtMs: settledAt,
          cancellationLatencyMs: cancellationStarted === undefined ? undefined : settledAt - cancellationStarted,
          mainThreadLongTasks: longTasks
            .filter((entry) => entry.startTime >= started && entry.startTime < settledAt)
            .map((entry) => ({ startTime: entry.startTime, durationMs: entry.duration })),
          longTaskObservationSupported: longTaskObserver !== undefined,
        };
      });
    return true;
  }
  async function startupFailure() {
    try {
      const session = await open({ type: 'integer' });
      session.dispose();
      throw new Error('worker unexpectedly initialized');
    } catch (error) {
      const diagnostic = failure(error);
      assert(diagnostic.message !== 'worker unexpectedly initialized', diagnostic.message);
      assert(
        diagnostic.name === 'SchemaExampleWorkerUnavailableError',
        `startup failure lost its typed diagnostic: ${JSON.stringify(diagnostic)}`,
      );
      assert(
        /worker|module|load|start|script|csp|security/i.test(diagnostic.message),
        `unclear startup diagnostic: ${diagnostic.message}`,
      );
      return diagnostic;
    }
  }
  async function recover() {
    const session = await open({ type: 'integer', const: 7 });
    try {
      assert(
        validValue(await generateSchemaExample(session, reference, { direction: 'request' })) === 7,
        'recovery failed',
      );
    } finally {
      session.dispose();
    }
    return { recovered: true };
  }
  return {
    ordinary,
    scopeAndGraph,
    startupFailure,
    startPathological,
    cancel: (mode: 'abort' | 'dispose' | 'runtime-dispose') => {
      cancellationStarted = performance.now();
      if (mode === 'runtime-dispose') workerRuntime.dispose();
      else if (mode === 'dispose') activeSession?.dispose();
      else activeController?.abort();
    },
    result: () => activeTask,
    recover,
    dispose: () => {
      activeSession?.dispose();
      workerRuntime.dispose();
      longTaskObserver?.disconnect();
    },
  };
}
