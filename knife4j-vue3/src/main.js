import { createApp, defineAsyncComponent } from 'vue'
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
import MethodType from '@/components/common/MethodApi.vue'

const ApiInfo = defineAsyncComponent(() => import('@/views/api/index.vue'))
const Authorize = defineAsyncComponent(() => import('@/views/settings/Authorize.vue'))
const SwaggerModels = defineAsyncComponent(() => import('@/views/settings/SwaggerModels.vue'))
const GlobalParameters = defineAsyncComponent(() => import('@/views/settings/GlobalParameters.vue'))
const Settings = defineAsyncComponent(() => import('@/views/settings/Settings.vue'))
const OfficelineDocument = defineAsyncComponent(() => import('@/views/settings/OfficelineDocument.vue'))
const OtherMarkdown = defineAsyncComponent(() => import('@/views/othermarkdown/index.vue'))

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
app.component('Othermarkdown', OtherMarkdown)
app.component('MethodType', MethodType)
setupStore(app)
setupI18n(app)
app.mount('#app')
