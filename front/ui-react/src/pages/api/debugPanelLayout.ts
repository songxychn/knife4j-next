import {
  KNIFE4J_STORAGE_KEYS,
  getKnife4jStorageItem,
  removeKnife4jStorageItem,
  setKnife4jStorageItem,
} from '../../storage/knife4jStorage';

export const DEBUG_PANEL_MIN_HEIGHT = 120;
export const DEBUG_PANEL_MAX_HEIGHT = 1600;
export const DEBUG_PANEL_DEFAULT_MAX_HEIGHT = 400;

export interface DebugPanelLayout {
  requestBodyHeight?: number;
  responseBodyHeight?: number;
}

type LayoutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultLayoutStorage(): LayoutStorage | null {
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

export function clampDebugPanelHeight(
  height: number,
  min = DEBUG_PANEL_MIN_HEIGHT,
  max = DEBUG_PANEL_MAX_HEIGHT,
): number {
  return Math.min(max, Math.max(min, Math.round(height)));
}

function parseValidHeight(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return clampDebugPanelHeight(value);
}

export function readDebugPanelLayout(storage: LayoutStorage | null = defaultLayoutStorage()): DebugPanelLayout {
  if (!storage) return {};
  const raw = getKnife4jStorageItem(storage, KNIFE4J_STORAGE_KEYS.debugPanelLayout);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const requestBodyHeight = parseValidHeight(record.requestBodyHeight);
    const responseBodyHeight = parseValidHeight(record.responseBodyHeight);
    const result: DebugPanelLayout = {};
    if (requestBodyHeight !== undefined) result.requestBodyHeight = requestBodyHeight;
    if (responseBodyHeight !== undefined) result.responseBodyHeight = responseBodyHeight;
    return result;
  } catch {
    return {};
  }
}

export function writeDebugPanelLayout(
  layout: DebugPanelLayout,
  storage: LayoutStorage | null = defaultLayoutStorage(),
): void {
  if (!storage) return;
  const sanitized: DebugPanelLayout = {};
  const requestBodyHeight = parseValidHeight(layout.requestBodyHeight);
  const responseBodyHeight = parseValidHeight(layout.responseBodyHeight);
  if (requestBodyHeight !== undefined) sanitized.requestBodyHeight = requestBodyHeight;
  if (responseBodyHeight !== undefined) sanitized.responseBodyHeight = responseBodyHeight;
  if (sanitized.requestBodyHeight === undefined && sanitized.responseBodyHeight === undefined) {
    removeKnife4jStorageItem(storage, KNIFE4J_STORAGE_KEYS.debugPanelLayout);
    return;
  }
  setKnife4jStorageItem(storage, KNIFE4J_STORAGE_KEYS.debugPanelLayout, JSON.stringify(sanitized));
}
