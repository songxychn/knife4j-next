interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

function createUuidFromRandomValues(getRandomValues: (array: Uint8Array) => Uint8Array): string {
  const bytes = getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

export function createClientId(cryptoApi: CryptoLike | null | undefined = globalThis.crypto): string {
  const randomUUID = cryptoApi?.randomUUID;
  if (typeof randomUUID === 'function') {
    return randomUUID.call(cryptoApi);
  }

  const getRandomValues = cryptoApi?.getRandomValues;
  if (typeof getRandomValues === 'function') {
    return createUuidFromRandomValues((bytes) => getRandomValues.call(cryptoApi, bytes));
  }

  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
