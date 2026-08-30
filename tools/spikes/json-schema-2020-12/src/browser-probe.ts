import {
  HyperjumpSchemaEngineProbe,
  JSON_SCHEMA_2020_12,
} from './hyperjump-adapter'

const rootUri = 'https://browser-probe.knife4j.example/tree'
const strictUri = 'https://browser-probe.knife4j.example/strict-tree'

export const runBrowserProbe = async (): Promise<Record<string, unknown>> => {
  const engine = new HyperjumpSchemaEngineProbe()

  try {
    await engine.registerDocument(
      {
        $schema: JSON_SCHEMA_2020_12,
        $id: rootUri,
        $dynamicAnchor: 'node',
        type: 'object',
        properties: {
          value: true,
          children: {
            type: 'array',
            items: { $dynamicRef: '#node' },
          },
        },
      },
      rootUri,
    )
    await engine.registerDocument(
      {
        $schema: JSON_SCHEMA_2020_12,
        $id: strictUri,
        $dynamicAnchor: 'node',
        $ref: rootUri,
        unevaluatedProperties: false,
      },
      strictUri,
    )

    const valid = await engine.evaluate(strictUri, {
      value: 'root',
      children: [{ value: 'leaf', children: [] }],
    })
    const invalid = await engine.evaluate(strictUri, {
      value: 'root',
      children: [{ value: 'leaf', extra: true }],
    })
    const resource = await engine.resolve(strictUri)

    if (!valid.valid || invalid.valid) {
      throw new Error('Dynamic reference evaluation produced an unexpected result.')
    }

    return {
      valid: valid.valid,
      invalidRejected: !invalid.valid,
      dialectId: resource.dialectId,
      dynamicAnchors: Object.keys(resource.dynamicAnchors),
      externalResourceLoading: 'disabled',
    }
  } finally {
    engine.dispose()
  }
}

declare global {
  interface Window {
    knife4jSchemaProbe?: Record<string, unknown>
  }
}

try {
  const result = await runBrowserProbe()
  window.knife4jSchemaProbe = result
  document.body.dataset.status = 'passed'
  document.querySelector('output')!.textContent = JSON.stringify(result)
} catch (error) {
  document.body.dataset.status = 'failed'
  document.querySelector('output')!.textContent =
    error instanceof Error ? error.stack ?? error.message : String(error)
  throw error
}
