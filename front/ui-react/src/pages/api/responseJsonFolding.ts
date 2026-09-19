import { prepareJsonDocument, type JsonDocument } from '../../utils/jsonFolding';
export { firstLevelFoldEffects } from '../../utils/jsonFolding';

/** Preserve the response panel's existing formatting and invalid-JSON fallback. */
export function prepareResponseJson(raw: string): JsonDocument {
  try {
    return prepareJsonDocument(JSON.stringify(JSON.parse(raw), null, 2), true);
  } catch {
    return { text: raw, valid: false, folds: [] };
  }
}
