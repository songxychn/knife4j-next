<template>
  <div id="app">
    <a-config-provider :locale="antDesignLocale">
      <a-spin :spinning="showLoading" :tip="loadingTip">
        <router-view />
      </a-spin>
    </a-config-provider>
  </div>
</template>
<script setup>

import { useGlobalsStore } from '@/store/modules/global.js'
import { normalizeLanguage } from '@/lang/index.js'
import { computed, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import enUS from 'ant-design-vue/es/locale/en_US'
import jaJP from 'ant-design-vue/es/locale/ja_JP'

const store = useGlobalsStore()
const { t } = useI18n()

const antDesignLocales = {
  'zh-CN': zhCN,
  'en-US': enUS,
  'ja-JP': jaJP,
}

const showLoading = computed(() => {
  return store.loading.show
})
const loadingTip = computed(() => {
  return store.loading.text || t('app.loading')
})
const antDesignLocale = computed(() => {
  return antDesignLocales[normalizeLanguage(store.language)]
})

watchEffect(() => {
  document.documentElement.lang = normalizeLanguage(store.language)
})
</script>

<style>
/* 字体优化 */
* {
  font-family: 'PingFang SC', 'Source Han Sans CN', 'Helvetica Neue', Helvetica, 'Hiragino Sans GB', 'Microsoft YaHei',
    '微软雅黑', Arial, sans-serif;
}

/* Ace relies on monospace metrics to keep cursor and text positions aligned. */
.ace_editor,
.ace_editor * {
  font-family: Monaco, Menlo, Consolas, 'Liberation Mono', monospace !important;
  font-variant-ligatures: none;
  letter-spacing: 0 !important;
}

/* 滚动条优化 */
body {
  overflow-y: scroll;
}

html {
  overflow-y: overlay;
}

::-webkit-scrollbar {
  width: 6px;
  background-color: transparent;
}

::-webkit-scrollbar:horizontal {
  height: 6px;
}

::-webkit-scrollbar-track {
  border-radius: 10px;
}

::-webkit-scrollbar-thumb {
  background-color: #0003;
  border-radius: 10px;
  transition: all 0.2s ease-in-out;
}

::-webkit-scrollbar-thumb:hover {
  cursor: pointer;
  background-color: #0000004d;
}
</style>
