<template>
  <div>
    <editor :value="value" @init="editorInit" :lang="lang" theme="eclipse" width="100%" :style="{height: editorHeight + 'px'}"
      @input="change"></editor>
  </div>
</template>

<script>
import { VAceEditor } from 'vue3-ace-editor'
import { initAce } from '@/core/aceLoader'

initAce()

export default {
  name: "EditorShow",
  components: { editor: VAceEditor },
  props: {
    value: {
      type: [String, Object],
      required: true,
      default: ""
    },
    xmlMode: {
      type: Boolean,
      default: false,
      required: false
    }
  },
  emits: ['showDescription', 'change'],
  data() {
    return {
      lang: "json",
      editor: null,
      editorHeight: 200
    };
  },
  methods: {
    change(value) {
      this.$emit("change", value);
    },
    resetEditorHeight() {
      const that = this
      // 重设高度
      setTimeout(() => {
        let length_editor = that.editor.session.getLength()
        if (length_editor == 1) {
          length_editor = 10;
        }
        that.editorHeight = length_editor * 16;
      }, 300);
    },
    editorInit(editor) {
      const that = this
      this.editor = editor;
      // require("brace/ext/language_tools"); //language extension prerequsite...
      // require("brace/mode/json");
      // require("brace/mode/xml");
      if (this.xmlMode) {
        this.lang = "xml";
      }
      // require("brace/theme/eclipse");
      // 重设高度
      this.resetEditorHeight();
      this.editor.renderer.on("afterRender", function () {
        that.$emit("showDescription", "123")
      });
    }
  }
};
</script>
