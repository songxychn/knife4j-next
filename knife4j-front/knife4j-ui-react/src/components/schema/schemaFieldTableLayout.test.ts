import { describe, expect, it } from 'vitest';
import type { SchemaFieldNode } from 'knife4j-core';
import { maxSchemaFieldDepth, schemaFieldTableLayout } from './schemaFieldTableLayout';

function field(name: string, children?: SchemaFieldNode[]): SchemaFieldNode {
  return {
    name,
    type: 'object',
    required: false,
    children,
  };
}

describe('schemaFieldTableLayout', () => {
  it('keeps the base field-name width for shallow schemas', () => {
    expect(schemaFieldTableLayout([field('id')])).toEqual({
      fieldNameWidth: 240,
      scrollX: 850,
    });
  });

  it('increases the field-name width for deep nested schemas', () => {
    const leaf = field('leaf');
    const level4 = field('level4', [leaf]);
    const level3 = field('level3', [level4]);
    const level2 = field('level2', [level3]);
    const level1 = field('level1', [level2]);
    const fields = [field('root', [level1])];

    expect(maxSchemaFieldDepth(fields)).toBe(5);
    expect(schemaFieldTableLayout(fields)).toEqual({
      fieldNameWidth: 360,
      scrollX: 970,
    });
  });

  it('caps the field-name width for very deep schemas', () => {
    let current = field('leaf');
    for (let i = 0; i < 20; i += 1) {
      current = field(`level${i}`, [current]);
    }

    expect(schemaFieldTableLayout([current])).toEqual({
      fieldNameWidth: 520,
      scrollX: 1130,
    });
  });
});
