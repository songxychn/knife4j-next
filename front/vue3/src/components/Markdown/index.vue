<template>
  <div class="knife4j-markdown" v-html="markdownSource">
  </div>
</template>

<script>
import "@/assets/css/markdown-preview.css";
import { marked, enableMarkdownCodeRenderer } from '@/core/markdown.js';

// Mermaid 体积较大，仅在文档实际包含图表时加载；加载失败时允许下次渲染重试。
let mermaidLoader = null;
function loadMermaid() {
  mermaidLoader ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ logLevel: 5, startOnLoad: false });
    return mermaid;
  }, error => {
    mermaidLoader = null;
    throw error;
  });
  return mermaidLoader;
}

enableMarkdownCodeRenderer();
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
  methods: {
    renderMermaid() {
      if (!this.$el.querySelector('.mermaid')) return;
      return loadMermaid().then(mermaid => mermaid.run({ querySelector: '.knife4j-markdown .mermaid' }));
    }
  },
  updated() {
    this.renderMermaid();
  },
  mounted() {
    this.renderMermaid();
  }
}
</script>

<style>
/* #528: flex parents (e.g. a-row.markdown-body) must not grow with long tokens / pre */
.knife4j-markdown {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}
</style>
