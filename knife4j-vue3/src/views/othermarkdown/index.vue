<template>
  <a-layout-content class="knife4j-body-content">
    <a-row class="markdown-body editormd-preview-container">
      <component :is="'MarkdownPreview'" :source="content" />
    </a-row>
  </a-layout-content>
</template>
<script>
import { defineAsyncComponent } from "vue";
import KUtils from "@/core/utils";
import localStore from "@/store/local.js";

const MarkdownPreview = defineAsyncComponent(() => import("@/components/Markdown/index.vue"));

export default {
  props: {
    data: {
      type: Object
    }
  },
  components: {
    MarkdownPreview
  },
  data() {
    return {
      content: ""
    };
  },
  created() {
    // 获取当前地址的id
    var that = this;
    var id = this.$route.params.id;
    var key = this.data.instance.id + 'markdownFiles';
    localStore.getItem(key).then(mdfileMap => {
      if (KUtils.checkUndefined(mdfileMap)) {
        var content = mdfileMap[id];
        if (KUtils.strNotBlank(content)) {
          that.content = content;
        }
      }
    })
  }
};
</script>
