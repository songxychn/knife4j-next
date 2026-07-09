<template>
  <div class="globalFooter">
    <a-row v-if="settings.enableFooterCustom">
      <component :is="'MarkdownPreview'" v-if="settings.enableFooterCustom" :source="settings.footerCustomContent" />
    </a-row>
    <div style="text-align: center" v-else-if="settings.enableFooter">
      <div class="copyright">Apache License 2.0 | Copyright
        <copyright-outlined /> 2019-2026 Knife4j Next Contributors
      </div>
    </div>
  </div>
</template>
<script>
import { computed, defineAsyncComponent } from 'vue'
import { useGlobalsStore } from '@/store/modules/global.js'
import { CopyrightOutlined } from '@ant-design/icons-vue'

const MarkdownPreview = defineAsyncComponent(() => import('../Markdown/index.vue'))

export default {
  name: "GlobalFooter",
  components: { MarkdownPreview, CopyrightOutlined },
  props: {
    links: {
      type: Array,
      default: () => {
        return [];
      }
    }
  },
  setup() {
    const globalsStore = useGlobalsStore()
    return {
      settings: computed(() => {
        return globalsStore.settings;
      })
    }
  }
};
</script>

<style lang="less" scoped>
@import "./index.less";
</style>
