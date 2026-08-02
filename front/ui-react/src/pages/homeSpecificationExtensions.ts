export interface DisplayExtension {
  key: string;
  value: string;
}

function toDisplayExtensionValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

export function collectSpecificationExtensions(source: Record<string, unknown> | undefined): DisplayExtension[] {
  if (!source) return [];

  return Object.entries(source).flatMap(([key, value]) => {
    if (!key.startsWith('x-')) return [];
    const displayValue = toDisplayExtensionValue(value);
    return displayValue === null ? [] : [{ key, value: displayValue }];
  });
}
