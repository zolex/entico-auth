import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  define: {
    __GIT_BRANCH__: JSON.stringify('test'),
  },
  test: { environment: 'jsdom' },
})
