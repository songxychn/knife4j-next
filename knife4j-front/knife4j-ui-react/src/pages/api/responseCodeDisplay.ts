export interface ResponseDisplayItem {
  statusCode: string;
}

function preferredStatusEntry<T extends ResponseDisplayItem>(items: T[]): T | undefined {
  return (
    items.find((item) => item.statusCode.startsWith('2')) ??
    items.find((item) => item.statusCode === 'default') ??
    items[0]
  );
}

export function responseRowsForDisplay<T extends ResponseDisplayItem>(
  responses: T[],
  enableResponseCode: boolean,
): T[] {
  if (enableResponseCode) return responses;
  const preferred = preferredStatusEntry(responses);
  return preferred ? [preferred] : [];
}

export function responseExamplesForDisplay<T extends ResponseDisplayItem>(
  examples: T[],
  enableResponseCode: boolean,
): T[] {
  if (enableResponseCode) return examples;
  const preferred = preferredStatusEntry(examples);
  return preferred ? [preferred] : [];
}
