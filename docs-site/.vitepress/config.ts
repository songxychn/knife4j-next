import { defineConfig } from 'vitepress'

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
      { text: '功能', link: '/#%E6%A0%B8%E5%BF%83%E5%8A%9F%E8%83%BD' },
      { text: '兼容矩阵', link: '/reference/compatibility' },
      { text: '迁移', link: '/guide/migration' },
      { text: 'GitHub', link: 'https://github.com/songxychn/knife4j-next' }
    ],
    sidebar: [
      {
        text: '开始使用',
        items: [
          { text: '产品介绍', link: '/' },
          { text: '快速开始', link: '/guide/getting-started' },
          { text: '迁移指引', link: '/guide/migration' }
        ]
      },
      {
        text: '参考',
        items: [
          { text: '兼容矩阵', link: '/reference/compatibility' },
          { text: '模块说明', link: '/reference/modules' },
          { text: '发布说明', link: '/release-notes/' }
        ]
      },
      {
        text: '规划',
        items: [
          { text: '下一步路线图', link: '/roadmap/' }
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
