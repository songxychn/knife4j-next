import type { JsonValue } from './types';

/** Compact JSON string bytes, including escaping and well-formed lone surrogates. */
export function quotedStringBytes(value: string): number {
  let bytes = 2;
  for (let offset = 0; offset < value.length; offset += 1) {
    const point = value.codePointAt(offset)!;
    if (point > 0xffff) {
      bytes += 4;
      offset += 1;
    } else if (point === 0x22 || point === 0x5c) bytes += 2;
    else if (point < 0x20) bytes += [0x08, 0x09, 0x0a, 0x0c, 0x0d].includes(point) ? 2 : 6;
    else if (point >= 0xd800 && point <= 0xdfff) bytes += 6;
    else bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : 3;
  }
  return bytes;
}

export function adjustedString(value: string, schema: { [key: string]: JsonValue }, maxLength: number): string | null {
  const min = typeof schema.minLength === 'number' ? Math.max(0, Math.floor(schema.minLength)) : 0;
  const max = typeof schema.maxLength === 'number' ? Math.max(0, Math.floor(schema.maxLength)) : maxLength;
  if (min > max || min > maxLength) return null;
  const cappedMax = Math.min(max, maxLength);
  const points = Array.from(value);
  if (points.length < min) points.push(...Array.from({ length: min - points.length }, () => 'a'));
  return points.slice(0, cappedMax).join('');
}

function patternSamples(pattern: string, maxLength: number): string[] {
  const samples: string[] = [];
  const exactClass = /^\^\[([A-Za-z0-9-]+)\]\{(\d+)(?:,(\d+))?\}\$$/.exec(pattern);
  if (exactClass) {
    const count = Math.min(Number(exactClass[2]), maxLength);
    const classValue = exactClass[1];
    const char = classValue.includes('A-Z') ? 'A' : classValue.includes('a-z') ? 'a' : '0';
    samples.push(char.repeat(count));
  }
  const literal = /^\^([A-Za-z0-9 _.-]+)\$$/.exec(pattern);
  if (literal) samples.push(literal[1]);
  if (pattern.includes('\\d') || pattern.includes('[0-9]')) samples.push('0', '000000');
  if (pattern.includes('[A-Z]')) samples.push('A', 'ABC');
  if (pattern.includes('[a-z]')) samples.push('a', 'abc');
  return samples;
}

export function stringSamples(schema: { [key: string]: JsonValue }, maxLength: number, minLength: number): string[] {
  const samplesByFormat: Record<string, string> = {
    date: '2024-01-01',
    'date-time': '2024-01-01T00:00:00Z',
    time: '00:00:00Z',
    duration: 'P1D',
    email: 'user@example.com',
    hostname: 'example.com',
    ipv4: '192.0.2.1',
    ipv6: '2001:db8::1',
    uri: 'https://example.com',
    uuid: '00000000-0000-4000-8000-000000000000',
    byte: 'AA==',
    binary: '',
  };
  const formatSample = typeof schema.format === 'string' ? samplesByFormat[schema.format] : undefined;
  const rawSamples = [
    ...(formatSample === undefined ? [] : [formatSample]),
    ...(typeof schema.pattern === 'string' ? patternSamples(schema.pattern, maxLength) : []),
    '',
    'string',
    'example',
    'a',
    '0',
  ];
  if (minLength <= maxLength) rawSamples.push('a'.repeat(minLength), '0'.repeat(minLength));
  if (typeof schema.contentMediaType === 'string' && schema.contentMediaType.toLowerCase().includes('json')) {
    rawSamples.unshift('{}');
  }
  return rawSamples;
}

export function numberSamples(schema: { [key: string]: JsonValue }, integer: boolean): number[] {
  const values: number[] = [0, 1, -1];
  const minimum = typeof schema.minimum === 'number' ? schema.minimum : undefined;
  const exclusiveMinimum = typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum : undefined;
  const maximum = typeof schema.maximum === 'number' ? schema.maximum : undefined;
  const exclusiveMaximum = typeof schema.exclusiveMaximum === 'number' ? schema.exclusiveMaximum : undefined;
  const multipleOf = typeof schema.multipleOf === 'number' && schema.multipleOf > 0 ? schema.multipleOf : undefined;
  if (minimum !== undefined) values.unshift(minimum);
  if (exclusiveMinimum !== undefined) values.unshift(exclusiveMinimum + (integer ? 1 : (multipleOf ?? 0.5)));
  if (maximum !== undefined) values.push(maximum);
  if (exclusiveMaximum !== undefined) values.push(exclusiveMaximum - (integer ? 1 : (multipleOf ?? 0.5)));
  if (multipleOf !== undefined) {
    const base = exclusiveMinimum ?? minimum ?? 0;
    const multiplier = Math.ceil(base / multipleOf + (exclusiveMinimum === undefined ? 0 : Number.EPSILON));
    values.unshift(multiplier * multipleOf);
  }
  return values.map((value) => (integer ? Math.round(value) : value)).filter((value) => Number.isFinite(value));
}
