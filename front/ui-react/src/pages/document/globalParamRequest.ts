import type {
  GlobalParamCredentialsMode,
  GlobalParamHttpRequest,
  GlobalParamValueRequest,
} from '../../context/GlobalParamContext';
import { extractSingleJsonPathScalar } from '../api/responseExtraction';

type Fetcher = typeof fetch;

function requestUrl(url: string, baseUrl: string): string {
  const trimmed = url.trim();
  if (!trimmed) throw new Error('请求地址不能为空');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return new URL(trimmed.replace(/^\/+/, ''), `${baseUrl.replace(/\/+$/, '')}/`).toString();
}

function requestHeaders(raw: string): Record<string, string> {
  if (!raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('请求头必须是 JSON 对象');
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([name, value]) => {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error(`请求头 ${name} 的值必须是字符串、数字或布尔值`);
      }
      return [name, String(value)];
    }),
  );
}

export async function executeConfiguredRequest(
  config: GlobalParamHttpRequest,
  baseUrl: string,
  credentials: GlobalParamCredentialsMode,
  fetcher: Fetcher = fetch,
): Promise<Response> {
  const init: RequestInit = {
    method: config.method,
    headers: requestHeaders(config.headers),
    credentials,
  };
  if (!['GET', 'HEAD'].includes(config.method) && config.body !== '') {
    init.body = config.body;
  }

  const response = await fetcher(requestUrl(config.url, baseUrl), init);
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`请求失败：${response.status}${detail ? ` ${detail}` : ''}`);
  }
  return response;
}

export async function fetchGlobalParamValue(
  config: GlobalParamValueRequest,
  baseUrl: string,
  credentials: GlobalParamCredentialsMode,
  fetcher: Fetcher = fetch,
): Promise<string> {
  const response = await executeConfiguredRequest(config, baseUrl, credentials, fetcher);
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error('响应体不是有效的 JSON');
  }

  const value = extractSingleJsonPathScalar(json, config.jsonPath);
  return `${config.prefix}${value}`;
}
