import type { OperationObject } from '../../types/swagger';

export function normalizeOperationAuthors(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((author) => author.trim())
    .filter(Boolean);
}

export function operationAuthors(operation: Pick<OperationObject, 'x-author'> | undefined): string[] {
  return normalizeOperationAuthors(operation?.['x-author']);
}
