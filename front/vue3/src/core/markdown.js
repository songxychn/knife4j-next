import { marked, TextRenderer } from 'marked'

/*
 * Legacy heading serialization and collision handling adapted from Marked 5.1.0
 * (src/Slugger.js and src/helpers.js): https://github.com/markedjs/marked/tree/v5.1.0
 *
 * Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/)
 * Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
// Marked 5 escaped inline token text during lexing. Marked 18 leaves code
// spans/autolinks raw and decodes entities in text tokens. Reconstruct only
// the legacy heading-ID input; the visible heading still uses its renderer.
function escapeHeadingText(text, encode = false) {
  const replacements = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  const pattern = encode ? /[&<>"']/g : /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g
  return text.replace(pattern, character => replacements[character])
}

function legacyHeadingText(tokens, parser) {
  const renderer = new TextRenderer()
  const inline = token => parser.parseInline(token.tokens, renderer)
  renderer.strong = renderer.em = renderer.del = inline
  renderer.link = token => token.autolink ? escapeHeadingText(token.text) : inline(token)
  // V5 used the unparsed image label, even when it contained inline Markdown.
  renderer.image = token => escapeHeadingText(token.text)
  renderer.codespan = token => escapeHeadingText(token.text, true)
  renderer.text = token => {
    if (token.escaped) return token.text // raw HTML code/pre/script content
    // Escape tokens contain the decoded character; ordinary text must use raw
    // to retain V5 numeric/named entity handling in headingText below.
    return escapeHeadingText(token.type === 'escape' ? token.text : token.raw)
  }
  return parser.parseInline(tokens, renderer)
}

function headingText(text) {
  return text.replace(/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig, (_, entity) => {
    entity = entity.toLowerCase()
    if (entity === 'colon') return ':'
    if (entity[0] === '#') {
      return entity[1] === 'x'
        ? String.fromCharCode(parseInt(entity.substring(2), 16))
        : String.fromCharCode(+entity.substring(1))
    }
    return ''
  })
}

function headingId(text, seen) {
  const original = text.toLowerCase().trim()
    .replace(/<[!\/a-z].*?>/ig, '')
    .replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g, '')
    .replace(/\s/g, '-')
  let id = original
  let count = 0
  if (Object.prototype.hasOwnProperty.call(seen, id)) {
    count = seen[original]
    do {
      id = original + '-' + ++count
    } while (Object.prototype.hasOwnProperty.call(seen, id))
  }
  seen[original] = count
  seen[id] = 0
  return id
}

// A fresh Parser is created for each parse; nested headings share its counters.
// A module-global counter would incorrectly suffix titles in later documents.
const headingsByParser = new WeakMap()
marked.use({
  gfm: true,
  breaks: false,
  pedantic: false,
  renderer: {
    heading({ tokens, depth }) {
      let seen = headingsByParser.get(this.parser)
      if (!seen) {
        seen = {}
        headingsByParser.set(this.parser, seen)
      }
      const text = this.parser.parseInline(tokens)
      const raw = headingText(legacyHeadingText(tokens, this.parser))
      return `<h${depth} id="${headingId(raw, seen)}">${text}</h${depth}>\n`
    }
  }
})

let markdownCodeRendererEnabled = false
export function enableMarkdownCodeRenderer() {
  if (markdownCodeRendererEnabled) return
  markdownCodeRendererEnabled = true
  // Keep the component's existing global activation point and output. use()
  // merges only code, so it cannot discard the heading renderer above.
  marked.use({
    renderer: {
      code({ text: code, lang: language }) {
        if (language === 'mermaid') {
          return '<pre class="mermaid">' + code + '</pre>'
        }
        return '<pre><code class="language-' + escapeHeadingText(String(language), true) + '">' + escapeHeadingText(code, true) + '</code></pre>'
      }
    }
  })
}

export { marked }
