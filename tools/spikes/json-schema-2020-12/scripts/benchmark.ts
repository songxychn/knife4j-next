import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { validate } from '@hyperjump/json-schema/openapi-3-1'
import {
  HyperjumpSchemaEngineProbe,
  JSON_SCHEMA_2020_12,
  type JsonValue,
} from '../src/hyperjump-adapter'

const makeCase = (propertyCount: number) => {
  const properties: Record<string, JsonValue> = {}
  const instance: Record<string, JsonValue> = {}
  const required: string[] = []

  for (let index = 0; index < propertyCount; index += 1) {
    const name = `field_${index}`
    properties[name] = { type: 'integer', minimum: index }
    instance[name] = index
    required.push(name)
  }

  return {
    schema: {
      $schema: JSON_SCHEMA_2020_12,
      type: 'object',
      properties,
      required,
      unevaluatedProperties: false,
    } satisfies JsonValue,
    instance: instance satisfies JsonValue,
  }
}

const runCase = async (propertyCount: number) => {
  const engine = new HyperjumpSchemaEngineProbe()
  const uri = `https://benchmark.knife4j.example/schema-${propertyCount}`
  const { schema, instance } = makeCase(propertyCount)
  const schemaBytes = new TextEncoder().encode(JSON.stringify(schema)).byteLength

  const registrationStarted = performance.now()
  await engine.registerDocument(schema, uri)
  const registrationMs = performance.now() - registrationStarted

  const compilationStarted = performance.now()
  const validator = await validate(uri)
  const compilationMs = performance.now() - compilationStarted

  const iterations = propertyCount >= 10_000 ? 5 : 20
  const validationStarted = performance.now()
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const result = validator(instance)
    if (!result.valid) {
      throw new Error(`Benchmark instance unexpectedly failed for ${propertyCount} properties.`)
    }
  }
  const validationMs = (performance.now() - validationStarted) / iterations

  engine.dispose()
  return {
    propertyCount,
    schemaBytes,
    registrationMs: Number(registrationMs.toFixed(2)),
    compilationMs: Number(compilationMs.toFixed(2)),
    validationMs: Number(validationMs.toFixed(2)),
    iterations,
  }
}

const report = {
  runtime: `Bun ${Bun.version}`,
  platform: `${process.platform}-${process.arch}`,
  generatedAt: new Date().toISOString(),
  cases: [],
} as {
  runtime: string
  platform: string
  generatedAt: string
  cases: Awaited<ReturnType<typeof runCase>>[]
}

for (const propertyCount of [250, 2_500, 10_000]) {
  report.cases.push(await runCase(propertyCount))
}

const output = resolve(import.meta.dir, '../dist/benchmark-report.json')
await Bun.write(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
