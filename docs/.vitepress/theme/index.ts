import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import ScreenshotGallery from './components/ScreenshotGallery.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ScreenshotGallery', ScreenshotGallery)
  },
} satisfies Theme
