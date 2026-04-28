import { createApp } from 'vue'
import './style/knife4j.less'
import App from './App.vue'
import { setupStore } from './store/index.js'
import router from '@/router/index.js'
import { setupI18n } from '@/lang/index.js'
import { createFromIconfontCN } from '@ant-design/icons-vue'
import axios from 'axios'

String.prototype.gblen = function () {
  let len = 0
  for (let i = 0; i < this.length; i++) {
    if (this.charCodeAt(i) > 127 || this.charCodeAt(i) == 94) {
      len += 2;
    } else {
      len++;
    }
  }
  return len;
}

String.prototype.startWith = function (str) {
  const reg = new RegExp("^" + str)
  return reg.test(this);
}

/***
 * 自定义图标
 */
import iconFront from './assets/iconfonts/iconfont.js'
const MyIcon = createFromIconfontCN({
  scriptUrl: iconFront
})

/***
 * 全局组件，与 knife4j-vue (Vue 2) 行为保持一致：
 * 供用户在模板中以组件标签直接引用（如 <ApiInfo>, <Authorize>）
 */
import Main from '@/views/index/Main.vue'
import ApiInfo from '@/views/api/index.vue'
import Authorize from '@/views/settings/Authorize.vue'
import SwaggerModels from '@/views/settings/SwaggerModels.vue'
import GlobalParameters from '@/views/settings/GlobalParameters.vue'
import Settings from '@/views/settings/Settings.vue'
import OfficelineDocument from '@/views/settings/OfficelineDocument.vue'
import OtherMarkdown from '@/views/othermarkdown/index.vue'
import MethodType from '@/components/common/MethodApi.vue'

/***
 * 响应数据拦截器（与 knife4j-vue main.js 行为一致）
 * 默认直接返回 response.data，避免业务代码重复写 res.data
 */
axios.interceptors.response.use(function (response) {
  return response.data;
}, function (error) {
  return Promise.reject(error);
})

const app = createApp(App)
app.use(router)
app.component('my-icon', MyIcon)
app.component('Main', Main)
app.component('ApiInfo', ApiInfo)
app.component('Authorize', Authorize)
app.component('SwaggerModels', SwaggerModels)
app.component('GlobalParameters', GlobalParameters)
app.component('Settings', Settings)
app.component('OfficelineDocument', OfficelineDocument)
app.component('OtherMarkdown', OtherMarkdown)
app.component('MethodType', MethodType)
setupStore(app)
setupI18n(app)
app.mount('#app')
