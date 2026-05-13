<template>
  <a-layout-content class="knife4j-body-content" v-if="swaggerCurrentInstance">
    <a-row class="markdown-body editormd-preview-container" v-if="settings?.enableHomeCustom">
      <Markdown :source="settings.homeCustomLocation || ''" />
    </a-row>
    <div class="home-page" v-else>
      <section class="home-hero">
        <img class="home-hero-mark" :src="knife4jMark" alt="" aria-hidden="true" />
        <div class="home-hero-tags">
          <a-tag class="home-hero-tag">
            <CodeOutlined />
            <span>{{ specLabel }}</span>
          </a-tag>
          <a-tag class="home-hero-tag">
            <InfoCircleOutlined />
            <span>{{ versionLabel }}</span>
          </a-tag>
        </div>
        <h1>{{ swaggerCurrentInstance.title || 'Knife4j' }}</h1>
        <div class="home-hero-description" v-if="swaggerCurrentInstance.description" v-html="swaggerCurrentInstance.description" />
      </section>

      <a-row :gutter="[16, 16]" class="home-stat-grid">
        <a-col :xs="24" :sm="12" :lg="6">
          <a-card class="home-stat-card" size="small" :bordered="false">
            <div class="home-stat-card-inner">
              <div class="home-stat-icon home-stat-icon-primary">
                <ApiOutlined />
              </div>
              <div>
                <div class="home-stat-label">{{ $t('homePage.apiTotal') }}</div>
                <div class="home-stat-value">{{ apiTotal }}</div>
              </div>
            </div>
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="12" :lg="6">
          <a-card class="home-stat-card" size="small" :bordered="false">
            <div class="home-stat-card-inner">
              <div class="home-stat-icon home-stat-icon-success">
                <TagsOutlined />
              </div>
              <div>
                <div class="home-stat-label">{{ $t('homePage.groupName') }}</div>
                <div class="home-stat-value home-stat-text">{{ swaggerCurrentInstance.name || '-' }}</div>
              </div>
            </div>
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="12" :lg="6">
          <a-card class="home-stat-card" size="small" :bordered="false">
            <div class="home-stat-card-inner">
              <div class="home-stat-icon home-stat-icon-warning">
                <InfoCircleOutlined />
              </div>
              <div>
                <div class="home-stat-label">{{ $t('homePage.version') }}</div>
                <div class="home-stat-value home-stat-text">{{ versionLabel }}</div>
              </div>
            </div>
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="12" :lg="6">
          <a-card class="home-stat-card" size="small" :bordered="false">
            <div class="home-stat-card-inner">
              <div class="home-stat-icon home-stat-icon-info">
                <CloudServerOutlined />
              </div>
              <div>
                <div class="home-stat-label">{{ $t('homePage.host') }}</div>
                <div class="home-stat-value home-stat-text">{{ hostLabel }}</div>
              </div>
            </div>
          </a-card>
        </a-col>
      </a-row>

      <a-row :gutter="[16, 16]" class="home-section-grid">
        <a-col :xs="24" :lg="14">
          <a-card class="home-card" size="small" :bordered="false">
            <template #title>
              <div class="home-card-title">
                <ApiOutlined />
                <span>{{ $t('homePage.methodDistribution') }}</span>
              </div>
            </template>
            <div class="method-grid" v-if="methodStats.length">
              <div class="method-item" v-for="method in methodStats" :key="method.method">
                <div class="method-item-header">
                  <a-tag :color="method.color">{{ method.method }}</a-tag>
                  <span>{{ method.count }}</span>
                </div>
                <div class="method-progress">
                  <span :style="{ width: `${method.percent}%`, backgroundColor: method.color }"></span>
                </div>
                <div class="method-percent">{{ method.percent }}%</div>
              </div>
            </div>
            <a-empty v-else :description="$t('homePage.noApiData')" />
          </a-card>
        </a-col>

        <a-col :xs="24" :lg="10">
          <a-card class="home-card" size="small" :bordered="false">
            <template #title>
              <div class="home-card-title">
                <FileTextOutlined />
                <span>{{ $t('homePage.documentInfo') }}</span>
              </div>
            </template>
            <div class="meta-list">
              <div class="meta-row" v-for="item in metaRows" :key="item.key">
                <div class="meta-label">
                  <component :is="item.icon" />
                  <span>{{ $t(item.label) }}</span>
                </div>
                <div class="meta-value" v-html="item.value || '-'"></div>
              </div>
            </div>
          </a-card>
        </a-col>
      </a-row>
    </div>
  </a-layout-content>
</template>
<script>
import { computed, defineAsyncComponent } from 'vue'
import { useGlobalsStore } from '@/store/modules/global.js'
import knife4jMark from '@/assets/logo/knife4j-next-mark.svg'
import {
  ApiOutlined,
  CloudServerOutlined,
  CodeOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  SafetyCertificateOutlined,
  TagsOutlined,
  UserOutlined
} from '@ant-design/icons-vue'

const METHOD_COLORS = {
  GET: '#61affe',
  POST: '#49cc90',
  PUT: '#fca130',
  DELETE: '#f93e3e',
  PATCH: '#50e3c2',
  HEAD: '#9012fe',
  OPTIONS: '#0d5aa7'
}

export default {
  props: {
    data: {
      type: Object
    }
  },
  components: {
    "Markdown": defineAsyncComponent(() => import('@/components/Markdown/index.vue')),
    ApiOutlined,
    CloudServerOutlined,
    CodeOutlined,
    FileTextOutlined,
    InfoCircleOutlined,
    LinkOutlined,
    SafetyCertificateOutlined,
    TagsOutlined,
    UserOutlined
  },
  setup() {
    const globalsStore = useGlobalsStore()
    const swaggerCurrentInstance = computed(() => {
      return globalsStore.swaggerCurrentInstance
    })

    const settings = computed(() => {
      return globalsStore.settings
    })

    const methodStats = computed(() => {
      const pathArrs = swaggerCurrentInstance.value?.pathArrs || []
      const total = pathArrs.reduce((sum, item) => sum + Number(item.count || 0), 0)

      return pathArrs
        .map(item => {
          const method = String(item.method || '').toUpperCase()
          const count = Number(item.count || 0)
          return {
            method,
            count,
            color: METHOD_COLORS[method] || '#4c96e8',
            percent: total > 0 ? Math.round((count / total) * 100) : 0
          }
        })
        .filter(item => item.method && item.count > 0)
    })

    const apiTotal = computed(() => {
      return methodStats.value.reduce((sum, item) => sum + item.count, 0)
    })

    const specLabel = computed(() => {
      const current = swaggerCurrentInstance.value || {}
      return `Swagger ${current.openApiBaseInfo?.swagger || current.groupVersion || '2.0'}`
    })

    const versionLabel = computed(() => {
      return swaggerCurrentInstance.value?.version || '-'
    })

    const hostLabel = computed(() => {
      return swaggerCurrentInstance.value?.host || '-'
    })

    const serviceAddressLabel = computed(() => {
      const current = swaggerCurrentInstance.value || {}
      const host = current.host || ''
      const basePath = current.basePath || ''
      if (host && basePath && basePath !== '/') {
        return `${host}${basePath}`
      }
      return host || basePath || '-'
    })

    const metaRows = computed(() => {
      const current = swaggerCurrentInstance.value || {}
      return [
        {
          key: 'author',
          label: 'homePage.author',
          value: current.contact,
          icon: 'UserOutlined'
        },
        {
          key: 'basePath',
          label: 'homePage.basePath',
          value: current.basePath,
          icon: 'LinkOutlined'
        },
        {
          key: 'serviceAddress',
          label: 'homePage.serviceAddress',
          value: serviceAddressLabel.value,
          icon: 'CloudServerOutlined'
        },
        {
          key: 'serviceUrl',
          label: 'homePage.serviceUrl',
          value: current.termsOfService,
          icon: 'SafetyCertificateOutlined'
        },
        {
          key: 'groupUrl',
          label: 'homePage.groupUrl',
          value: current.url,
          icon: 'LinkOutlined'
        },
        {
          key: 'groupLocation',
          label: 'homePage.groupLocation',
          value: current.location,
          icon: 'CloudServerOutlined'
        }
      ]
    })

    return {
      swaggerCurrentInstance,
      settings,
      methodStats,
      apiTotal,
      specLabel,
      versionLabel,
      hostLabel,
      metaRows,
      knife4jMark,
      title: 'knife4j'
    }
  }
};
</script>
<style scoped>
.home-page {
  padding: 20px;
  background: #f6f8fb;
  min-height: 100%;
}

.home-hero {
  position: relative;
  padding: 28px 32px;
  margin-bottom: 16px;
  overflow: hidden;
  color: #fff;
  background: linear-gradient(135deg, #1677ff 0%, #13a8a8 52%, #32c785 100%);
  border-radius: 8px;
  box-shadow: 0 8px 22px rgba(22, 119, 255, 0.18);
}

.home-hero-mark {
  position: absolute;
  right: -24px;
  bottom: -28px;
  width: 220px;
  height: 220px;
  opacity: 0.08;
  pointer-events: none;
}

.home-hero-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.home-hero-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #fff;
  background: rgba(255, 255, 255, 0.22);
  border: 0;
  border-radius: 4px;
}

.home-hero h1 {
  position: relative;
  max-width: 900px;
  margin: 0;
  color: #fff;
  font-size: 30px;
  font-weight: 700;
  line-height: 1.2;
  word-break: break-word;
}

.home-hero-description {
  position: relative;
  max-width: 900px;
  margin-top: 10px;
  color: rgba(255, 255, 255, 0.92);
  font-size: 14px;
  line-height: 1.7;
  word-break: break-word;
}

.home-hero-description :deep(p) {
  margin: 0;
}

.home-hero-description :deep(a) {
  color: #fff;
  text-decoration: underline;
}

.home-stat-grid {
  margin-bottom: 0;
}

.home-stat-card,
.home-card {
  height: 100%;
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(18, 38, 63, 0.06);
}

.home-stat-card :deep(.ant-card-body) {
  padding: 16px;
}

.home-stat-card-inner {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.home-stat-card-inner > div:last-child {
  min-width: 0;
}

.home-stat-icon {
  display: inline-flex;
  flex: 0 0 42px;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  font-size: 20px;
  border-radius: 8px;
}

.home-stat-icon-primary {
  color: #1677ff;
  background: rgba(22, 119, 255, 0.1);
}

.home-stat-icon-success {
  color: #10a37f;
  background: rgba(16, 163, 127, 0.12);
}

.home-stat-icon-warning {
  color: #d48806;
  background: rgba(250, 173, 20, 0.14);
}

.home-stat-icon-info {
  color: #13a8a8;
  background: rgba(19, 168, 168, 0.12);
}

.home-stat-label {
  margin-bottom: 4px;
  color: #697386;
  font-size: 12px;
  line-height: 18px;
}

.home-stat-value {
  color: #1f2937;
  font-size: 24px;
  font-weight: 700;
  line-height: 30px;
}

.home-stat-text {
  max-width: 180px;
  overflow: hidden;
  font-size: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-section-grid {
  margin-top: 16px;
}

.home-card :deep(.ant-card-head) {
  min-height: 46px;
  border-bottom-color: #edf1f7;
}

.home-card :deep(.ant-card-head-title) {
  padding: 12px 0;
}

.home-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #1f2937;
  font-size: 14px;
  font-weight: 600;
}

.method-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.method-item {
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #edf1f7;
  border-radius: 8px;
}

.method-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  color: #1f2937;
  font-size: 18px;
  font-weight: 700;
}

.method-item-header :deep(.ant-tag) {
  margin-right: 0;
  font-weight: 700;
}

.method-progress {
  height: 6px;
  overflow: hidden;
  background: #e8edf4;
  border-radius: 999px;
}

.method-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
}

.method-percent {
  margin-top: 6px;
  color: #697386;
  font-size: 12px;
}

.meta-list {
  display: flex;
  flex-direction: column;
}

.meta-row {
  display: grid;
  grid-template-columns: minmax(110px, 34%) minmax(0, 1fr);
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid #edf1f7;
}

.meta-row:last-child {
  border-bottom: 0;
}

.meta-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: #697386;
  font-size: 13px;
}

.meta-value {
  min-width: 0;
  color: #1f2937;
  font-size: 13px;
  line-height: 20px;
  overflow-wrap: anywhere;
}

.meta-value :deep(p) {
  margin: 0;
}

@media (max-width: 768px) {
  .home-page {
    padding: 12px;
  }

  .home-hero {
    padding: 22px 20px;
  }

  .home-hero h1 {
    font-size: 24px;
  }

  .meta-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
</style>
