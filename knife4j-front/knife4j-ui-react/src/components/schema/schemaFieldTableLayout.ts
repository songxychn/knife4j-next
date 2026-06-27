import type { SchemaFieldNode } from 'knife4j-core';

const FIELD_NAME_BASE_WIDTH = 240;
const FIELD_NAME_DEPTH_STEP = 24;
const FIELD_NAME_MAX_WIDTH = 520;
const TYPE_COLUMN_WIDTH = 160;
const REQUIRED_COLUMN_WIDTH = 90;
const DESCRIPTION_MIN_WIDTH = 360;
const TABLE_MIN_SCROLL_WIDTH = 840;

export type SchemaFieldTableColumnKey = 'fieldName' | 'type' | 'required' | 'description';

export type SchemaFieldTableColumnWidths = Record<SchemaFieldTableColumnKey, number>;

export const SCHEMA_FIELD_COLUMN_MIN_WIDTHS: SchemaFieldTableColumnWidths = {
  fieldName: 160,
  type: 120,
  required: 80,
  description: 240,
};

export interface SchemaFieldTableLayout {
  fieldNameWidth: number;
  columnWidths: SchemaFieldTableColumnWidths;
  scrollX: number;
}

export function maxSchemaFieldDepth(fields: Pick<SchemaFieldNode, 'children'>[], depth = 0): number {
  return fields.reduce((maxDepth, field) => {
    const childDepth = field.children ? maxSchemaFieldDepth(field.children, depth + 1) : depth;
    return Math.max(maxDepth, childDepth);
  }, depth);
}

export function schemaFieldTableScrollX(widths: SchemaFieldTableColumnWidths): number {
  return Math.max(TABLE_MIN_SCROLL_WIDTH, widths.fieldName + widths.type + widths.required + widths.description);
}

export function schemaFieldTableLayout(fields: SchemaFieldNode[]): SchemaFieldTableLayout {
  const fieldNameWidth = Math.min(
    FIELD_NAME_MAX_WIDTH,
    FIELD_NAME_BASE_WIDTH + maxSchemaFieldDepth(fields) * FIELD_NAME_DEPTH_STEP,
  );
  const columnWidths = {
    fieldName: fieldNameWidth,
    type: TYPE_COLUMN_WIDTH,
    required: REQUIRED_COLUMN_WIDTH,
    description: DESCRIPTION_MIN_WIDTH,
  };

  return {
    fieldNameWidth,
    columnWidths,
    scrollX: schemaFieldTableScrollX(columnWidths),
  };
}
