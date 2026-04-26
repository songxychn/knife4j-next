import {defineConfig} from 'vitepress'

const siteUrl = 'https://knife4jnext.com'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Knife4j Next',
  description: 'Spring 生态下的 OpenAPI 文档增强与接口调试工具',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['meta', { name: 'theme-color', content: '#69aefc' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Knife4j Next' }],
    ['meta', { property: 'og:title', content: 'Knife4j Next' }],
    ['meta', { property: 'og:description', content: 'Spring 生态下的 OpenAPI 文档增强与接口调试工具' }],
    ['meta', { property: 'og:url', content: siteUrl }],
    ['meta', { property: 'og:image', content: `${siteUrl}/knife4j-next-mark.svg` }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
    ['meta', { name: 'twitter:title', content: 'Knife4j Next' }],
    ['meta', { name: 'twitter:description', content: 'Spring 生态下的 OpenAPI 文档增强与接口调试工具' }],
    ['meta', { name: 'twitter:image', content: `${siteUrl}/knife4j-next-mark.svg` }],
    ['link', { rel: 'icon', href: '/knife4j-next-mark.svg' }]
  ],
  sitemap: {
    hostname: siteUrl
  },
  transformPageData(pageData) {
    const canonicalUrl = `${siteUrl}/${pageData.relativePath}`
      .replace(/index\.md$/, '')
      .replace(/\.md$/, '')

    pageData.frontmatter.head ??= []
    pageData.frontmatter.head.push([
      'link',
      { rel: 'canonical', href: canonicalUrl }
    ])
  },
  themeConfig: {
    logo: '/knife4j-next-logo.svg',
    siteTitle: 'Knife4j Next',
    nav: [
      { text: '快速开始', link: '/guide/getting-started' },
      { text: '功能', link: '/guide/features' },
      { text: '迁移', link: '/guide/migration' },
      { text: '配置参考', link: '/reference/configuration' },
      { text: '在线 Demo', link: 'https://demo.knife4jnext.com/doc.html' },
      { text: 'GitHub', link: 'https://github.com/songxychn/knife4j-next' }
    ],
    sidebar: [
      {
        text: '开始使用',
        items: [
          { text: '产品介绍', link: '/guide/introduction' },
          { text: '功能概览', link: '/guide/features' },
          { text: '快速开始', link: '/guide/getting-started' },
          { text: '在线 Demo', link: '/guide/demo' },
          { text: '从 upstream 迁移', link: '/guide/migration' },
          { text: '从 Springfox 迁移到 OpenAPI3', link: '/guide/springfox-migration' }
        ]
      },
      {
        text: '接入指南',
        items: [
          { text: 'Spring Cloud Gateway 聚合', link: '/guide/gateway' },
          { text: 'Disk / Nacos / Eureka 聚合', link: '/guide/aggregation' },
          { text: 'Spring WebFlux 接入', link: '/guide/webflux' },
          { text: '前端独立部署', link: '/guide/deployment' }
        ]
      },
      {
        text: '参考手册',
        items: [
          { text: '兼容矩阵', link: '/reference/compatibility' },
          { text: '版本参考', link: '/reference/version-ref' },
          { text: '模块说明', link: '/reference/modules' },
          { text: '配置参考', link: '/reference/configuration' },
          { text: '注解速查表', link: '/reference/annotations' }
        ]
      },
      {
        text: 'FAQ',
        items: [
          { text: '常见问题', link: '/guide/faq' }
        ]
      },
      {
        text: '项目',
        items: [
          { text: '发布说明', link: '/release-notes/' },
          { text: '路线图', link: '/roadmap/' }
        ]
      }
    ],
    outline: {
      level: [2, 3],
      label: '本页内容'
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/songxychn/knife4j-next' }
    ],
    search: {
      provider: 'local'
    },
    editLink: {
      pattern: 'https://github.com/songxychn/knife4j-next/edit/master/docs-site/:path',
      text: '在 GitHub 上编辑此页'
    },
    footer: {
      message: '让 OpenAPI 文档更清晰，让接口联调更顺手。',
      copyright: 'Apache-2.0 · Knife4j Next'
    }
  }
})
