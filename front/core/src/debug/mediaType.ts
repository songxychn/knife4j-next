const MEDIA_TYPE_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export function mediaTypeEssence(value: string): string {
  return value.split(';', 1)[0].trim().toLowerCase();
}

export function splitMediaTypes(value: string): string[] {
  const result: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ',') {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result.filter(Boolean);
}

export function splitMediaTypeParameters(value: string): string[] | null {
  const result: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ';') {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quoted || escaped) return null;
  result.push(value.slice(start).trim());
  return result;
}

function validQuotedMediaTypeValue(value: string): boolean {
  if (value.length < 2 || value[0] !== '"' || value[value.length - 1] !== '"') return false;
  let escaped = false;
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index];
    const code = character.charCodeAt(0);
    if (escaped) {
      if ((code < 0x20 && character !== '\t') || code === 0x7f) return false;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"' || (code < 0x20 && character !== '\t') || code === 0x7f) {
      return false;
    }
  }
  return !escaped;
}

export function validMediaType(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  const segments = splitMediaTypeParameters(value);
  if (!segments || segments.length === 0) return false;
  const [type = '', subtype = '', ...extra] = segments[0].split('/');
  if (extra.length > 0 || !MEDIA_TYPE_TOKEN.test(type) || !MEDIA_TYPE_TOKEN.test(subtype)) return false;
  return segments.slice(1).every((parameter) => {
    const equals = parameter.indexOf('=');
    if (equals <= 0) return false;
    const name = parameter.slice(0, equals).trim();
    const rawValue = parameter.slice(equals + 1).trim();
    return MEDIA_TYPE_TOKEN.test(name) && (MEDIA_TYPE_TOKEN.test(rawValue) || validQuotedMediaTypeValue(rawValue));
  });
}
