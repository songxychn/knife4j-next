export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function owns(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function appendJsonPointer(pointer: string, key: string | number): string {
  return `${pointer}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

export function decodeJsonPointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}
