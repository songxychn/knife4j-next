/**
 * clipboard.ts — shared clipboard utility
 *
 * Uses navigator.clipboard.writeText when available,
 * falls back to a hidden textarea + execCommand for older browsers.
 */
export function copyToClipboard(text: string, onDone: () => void, onFail: () => void): void {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(onDone).catch(onFail);
      return;
    }
  } catch {
    // fall through to textarea fallback
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) {
      onDone();
    } else {
      onFail();
    }
  } catch {
    onFail();
  }
}
