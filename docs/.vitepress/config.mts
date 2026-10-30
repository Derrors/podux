import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  // Published to GitHub Pages at https://derrors.github.io/podux/
  base: '/podux/',
  title: "Podux",
  description: "现代化的 Frpc 管理平台 - 基于 PocketBase 和 React 构建的强大内网穿透管理系统",
  head: [
    ['link', { rel: 'icon', type: 'image/x-icon', href: '/podux/favicon.ico' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/podux/logo.svg' }],
  ],
  metaChunk: true,

  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '首页', link: '/' },
          { text: '指南', link: '/guide/what-is-podux' },
        ],
        sidebar: [
          {
            text: '指南',
            items: [
              { text: '什么是 Podux?', link: '/guide/what-is-podux' },
              { text: '界面预览', link: '/guide/screenshots' },
              { text: '快速开始', link: '/guide/getting-started' },
              { text: '兼容性', link: '/guide/compatibility' },
            ]
          },
          {
            text: '功能',
            items: [
              { text: '代理进阶设置', link: '/guide/proxy-options' },
              { text: 'STCP/XTCP 与访问端', link: '/guide/secret-proxies' },
              { text: '流量与可达性', link: '/guide/traffic' },
              { text: '告警通知', link: '/guide/notifications' },
              { text: '导出配置', link: '/guide/export' },
            ]
          },
          {
            text: '安装部署',
            items: [
              {
                text: '安装',
                items: [
                  { text: '二进制', link: '/deploy/install/binary' },
                  { text: 'Docker', link: '/deploy/install/docker' },
                ]
              },
              {
                text: '升级',
                items: [
                  { text: '二进制', link: '/deploy/upgrade/binary' },
                  { text: 'Docker', link: '/deploy/upgrade/docker' },
                ]
              },
              { text: '数据与备份', link: '/deploy/backup' },
            ]
          },
          {
            text: '故障排除',
            items: [
              { text: '常见问题', link: '/troubleshoot/faq' },
            ]
          },
          {
            text: '参与开发',
            items: [
              { text: '贡献指南', link: 'https://github.com/Derrors/podux/blob/main/CONTRIBUTING.md' },
              { text: '设计文档', link: 'https://github.com/Derrors/podux/tree/main/development' },
            ]
          }
        ],
        footer: {
          message: '基于 Apache 2.0 协议开源',
          copyright: 'Copyright © 2026-present Podux'
        },
      }
    },
    en: {
      label: 'English',
      lang: 'en-US',
      description: "Modern Frpc Management Platform",
      themeConfig: {
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Guide', link: '/en/guide/what-is-podux' }
        ],
        sidebar: [
          {
            text: 'Guide',
            items: [
              { text: 'What is Podux?', link: '/en/guide/what-is-podux' },
              { text: 'Screenshots', link: '/en/guide/screenshots' },
              { text: 'Getting Started', link: '/en/guide/getting-started' },
              { text: 'Compatibility', link: '/en/guide/compatibility' }
            ]
          },
          {
            text: 'Features',
            items: [
              { text: 'Proxy Options', link: '/en/guide/proxy-options' },
              { text: 'STCP/XTCP and Visitors', link: '/en/guide/secret-proxies' },
              { text: 'Traffic and Reachability', link: '/en/guide/traffic' },
              { text: 'Alerts', link: '/en/guide/notifications' },
              { text: 'Export Config', link: '/en/guide/export' }
            ]
          },
          {
            text: 'Deployment',
            items: [
              {
                text: 'Install',
                items: [
                  { text: 'Binary', link: '/en/deploy/install/binary' },
                  { text: 'Docker', link: '/en/deploy/install/docker' }
                ]
              },
              {
                text: 'Upgrade',
                items: [
                  { text: 'Binary', link: '/en/deploy/upgrade/binary' },
                  { text: 'Docker', link: '/en/deploy/upgrade/docker' }
                ]
              },
              { text: 'Data and Backups', link: '/en/deploy/backup' }
            ]
          },
          {
            text: 'Troubleshooting',
            items: [
              { text: 'FAQ', link: '/en/troubleshoot/faq' }
            ]
          },
          {
            text: 'Development',
            items: [
              { text: 'Contributing', link: 'https://github.com/Derrors/podux/blob/main/CONTRIBUTING_en.md' },
              { text: 'Design Docs', link: 'https://github.com/Derrors/podux/tree/main/development' }
            ]
          }
        ],
        footer: {
          message: 'Released under the Apache 2.0 License.',
          copyright: 'Copyright © 2026-present Podux'
        },
      }
    }
  },

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: { src: '/logo.svg', width: 24, height: 24 },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Derrors/podux' }
    ],

    search: {
      provider: 'local'
    }
  }
})
