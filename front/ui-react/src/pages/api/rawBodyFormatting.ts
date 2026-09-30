import type { DebugCacheRawMode } from './debugCache';
import { prepareJsonDocument } from '../../utils/jsonFolding';

/** A request body must retain its meaning after formatting. */
export async function formatBodyByRawMode(value: string, mode: DebugCacheRawMode): Promise<string | undefined> {
  // Markup indentation changes text nodes. Without its schema/CSS context we
  // cannot safely rewrite XML/HTML, including mixed content and xml:space.
  if (mode !== 'json' && mode !== 'javascript') return undefined;

  try {
    if (mode === 'json') {
      const document = prepareJsonDocument(value);
      return document.valid ? document.text : undefined;
    }
    const [prettier, babel, estree] = await Promise.all([
      import('prettier/standalone'),
      import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
    ]);
    return await prettier.format(value, {
      parser: 'babel',
      plugins: [babel.default, estree.default],
      tabWidth: 2,
      // Formatting tagged templates must not reformat embedded request data.
      embeddedLanguageFormatting: 'off',
    });
  } catch {
    // Parse errors or an unavailable lazy-loaded chunk leave the input intact.
    return undefined;
  }
}
