<template>
  <div class="knife4j-markdown" v-html="markdownSource">
  </div>
</template>

<script>
import { marked } from 'marked';
import mermaid from 'mermaid';

mermaid.initialize({ logLevel: 5, startOnLoad: false });

// 按需加载
// https://mermaid.js.org/config/usage.html
var renderer = new marked.Renderer();
renderer.code = function (code, language) {
  if (language === 'mermaid') {
    // mermaid 11: use <pre class="mermaid"> placeholder, then call mermaid.run() after mount
    return '<pre class="mermaid">' + code + '</pre>';
  }
  else {
    return '<pre><code class="language-' + language + '">' + code + '</code></pre>';
  }
};
marked.setOptions({
  gfm: true,
  tables: true,
  breaks: false,
  pedantic: false,
  sanitize: false,
  smartLists: true,
  smartypants: false,
  renderer: renderer
})
export default {
  name: "Markdown",
  props: {
    source: {
      type: String
    }
  },
  computed: {
    markdownSource() {
      return marked.parse(this.source);
    }
  },
  updated() {
    mermaid.run({ querySelector: '.knife4j-markdown .mermaid' });
  },
  mounted() {
    mermaid.run({ querySelector: '.knife4j-markdown .mermaid' });
  }
}
</script>
