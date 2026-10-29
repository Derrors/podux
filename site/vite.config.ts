import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { iconifyOffline } from './vite-plugins/iconify-offline'

// Vendor chunks keyed by package name. Only packages that are exclusively used by the
// listed features may go into a lazily used chunk (chart-vendor), otherwise the entry
// would statically import it (and modulepreload it on first paint).
const VENDOR_CHUNKS: Record<string, string[]> = {
  'react-vendor': [
    'react',
    'react-dom',
    'scheduler',
    'react-router',
    'react-router-dom',
    'cookie',
    'set-cookie-parser',
    // shared by Radix, react-i18next and recharts
    'use-sync-external-store',
  ],
  'ui-vendor': [
    '@radix-ui/*',
    'radix-ui',
    'sonner',
    '@floating-ui/*',
    'react-remove-scroll',
    'react-remove-scroll-bar',
    'react-style-singleton',
    'use-callback-ref',
    'use-sidecar',
    'aria-hidden',
    'get-nonce',
    'detect-node-es',
    'classnames',
    'tslib',
  ],
  'motion-vendor': ['framer-motion', 'motion-dom', 'motion-utils'],
  'chart-vendor': [
    'recharts',
    'd3-*',
    'victory-vendor',
    'internmap',
    '@reduxjs/*',
    'react-redux',
    'redux',
    'redux-thunk',
    'immer',
    'reselect',
    'es-toolkit',
    'decimal.js-light',
    'eventemitter3',
    'tiny-invariant',
  ],
  'utils-vendor': ['i18next', 'react-i18next', 'html-parse-stringify', 'void-elements', 'pocketbase'],
}

const chunkByPackage = new Map<string, string>()
const chunkByPrefix: Array<[string, string]> = []
for (const [chunk, packages] of Object.entries(VENDOR_CHUNKS)) {
  for (const pkg of packages) {
    if (pkg.endsWith('*')) chunkByPrefix.push([pkg.slice(0, -1), chunk])
    else chunkByPackage.set(pkg, chunk)
  }
}

/** Package name of a module id inside node_modules (works with pnpm's nested layout). */
function packageName(id: string): string | undefined {
  const normalized = id.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/node_modules/')
  if (index === -1) return undefined
  const [first, second] = normalized.slice(index + '/node_modules/'.length).split('/')
  return first.startsWith('@') ? `${first}/${second}` : first
}

function manualChunks(id: string): string | undefined {
  // Rollup's CommonJS interop helpers are needed by eager and lazy chunks alike.
  if (id.startsWith('\0commonjsHelpers')) return 'react-vendor'
  const pkg = packageName(id)
  if (!pkg) return undefined
  return chunkByPackage.get(pkg) ?? chunkByPrefix.find(([prefix]) => pkg.startsWith(prefix))?.[1]
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    iconifyOffline({ srcDir: 'src', prefixes: ['lucide', 'circle-flags'] }),
  ],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
      }
    }
  },
  build: {
    // 代码分割优化
    rollupOptions: {
      output: {
        manualChunks,
        // 优化资源文件名
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },
    // 压缩优化
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // 移除 console
        drop_debugger: true, // 移除 debugger
        pure_funcs: ['console.log'], // 移除特定函数
      },
    },
    // 启用 CSS 代码分割
    cssCodeSplit: true,
    // 设置 chunk 大小警告限制
    chunkSizeWarningLimit: 600,
    // 生成 sourcemap（生产环境可以设为 false）
    sourcemap: false,
  },
  // 依赖优化
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@radix-ui/themes',
      'pocketbase',
      'i18next',
      'react-i18next',
    ],
  },
})
