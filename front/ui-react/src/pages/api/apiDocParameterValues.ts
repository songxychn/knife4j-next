import { buildSchemaFieldTree } from 'knife4j-core';
import type { SchemaValueDetailsProps } from '../../components/schema/SchemaValueDetails';
import type { ParameterObject } from '../../types/swagger';

/** Project the parameter itself, keeping array/object values distinct from their child fields. */
export function apiDocParameterValues(
  parameter: ParameterObject,
  document: Record<string, unknown>,
): SchemaValueDetailsProps & { title?: string } {
  const media = Object.values(parameter.content ?? {});
  const schema = parameter.schema ?? (media.length === 1 ? media[0].schema : undefined);
  if (schema === undefined) return {};
  const [field] = buildSchemaFieldTree(
    { type: 'object', properties: { parameter: schema } },
    { doc: document, maxDepth: 8 },
  );
  return { title: field?.title, enum: field?.enum, default: field?.default };
}
