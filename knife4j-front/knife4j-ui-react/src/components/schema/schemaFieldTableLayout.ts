import type { SchemaFieldNode } from 'knife4j-core';

const FIELD_NAME_BASE_WIDTH = 240;
const FIELD_NAME_DEPTH_STEP = 24;
const FIELD_NAME_MAX_WIDTH = 520;
const TYPE_COLUMN_WIDTH = 160;
const REQUIRED_COLUMN_WIDTH = 90;
const DESCRIPTION_MIN_WIDTH = 360;
const TABLE_MIN_SCROLL_WIDTH = 840;

export interface SchemaFieldTableLayout {
  fieldNameWidth: number;
  scrollX: number;
}

export function maxSchemaFieldDepth(fields: Pick<SchemaFieldNode, 'children'>[], depth = 0): number {
  return fields.reduce((maxDepth, field) => {
    const childDepth = field.children ? maxSchemaFieldDepth(field.children, depth + 1) : depth;
    return Math.max(maxDepth, childDepth);
  }, depth);
}

export function schemaFieldTableLayout(fields: SchemaFieldNode[]): SchemaFieldTableLayout {
  const fieldNameWidth = Math.min(
    FIELD_NAME_MAX_WIDTH,
    FIELD_NAME_BASE_WIDTH + maxSchemaFieldDepth(fields) * FIELD_NAME_DEPTH_STEP,
  );
  const scrollX = Math.max(
    TABLE_MIN_SCROLL_WIDTH,
    fieldNameWidth + TYPE_COLUMN_WIDTH + REQUIRED_COLUMN_WIDTH + DESCRIPTION_MIN_WIDTH,
  );

  return {
    fieldNameWidth,
    scrollX,
  };
}
