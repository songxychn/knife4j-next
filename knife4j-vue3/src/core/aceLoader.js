/**
 * Shared Ace editor loader.
 *
 * Centralises all ace-builds module URL registrations so that every editor
 * component uses the same on-demand (URL-based) loading strategy instead of
 * bundling Ace modules directly into component chunks.
 *
 * Usage:
 *   import { initAce } from '@/core/aceLoader'
 *   // call once at module level (idempotent)
 *   initAce()
 */

import ace from 'ace-builds'

// --- theme ---
import themeEclipse from 'ace-builds/src-noconflict/theme-eclipse?url'

// --- modes ---
import modeJson from 'ace-builds/src-noconflict/mode-json?url'
import modeJson5 from 'ace-builds/src-noconflict/mode-json5.js?url'
import modeXml from 'ace-builds/src-noconflict/mode-xml?url'
import modeText from 'ace-builds/src-noconflict/mode-text?url'
import modeJavascript from 'ace-builds/src-noconflict/mode-javascript?url'
import modeTypescript from 'ace-builds/src-noconflict/mode-typescript?url'

// --- extensions ---
import extLanguageTools from 'ace-builds/src-noconflict/ext-language_tools?url'

let _initialized = false

/**
 * Register all Ace module URLs with the Ace runtime.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initAce() {
  if (_initialized) return
  _initialized = true

  // theme
  ace.config.setModuleUrl('ace/theme/eclipse', themeEclipse)

  // modes
  ace.config.setModuleUrl('ace/mode/json', modeJson)
  ace.config.setModuleUrl('ace/mode/json5', modeJson5)
  ace.config.setModuleUrl('ace/mode/xml', modeXml)
  ace.config.setModuleUrl('ace/mode/text', modeText)
  ace.config.setModuleUrl('ace/mode/javascript', modeJavascript)
  ace.config.setModuleUrl('ace/mode/typescript', modeTypescript)

  // extensions
  ace.config.setModuleUrl('ace/ext/language_tools', extLanguageTools)
}
