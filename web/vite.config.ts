import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    target: 'es2022',
    // three 單塊約 550 kB（gzip 約 137 kB），已獨立快取；超過 600 kB 再檢查是否誤引入額外模組。
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // three 單獨成塊：遊戲程式碼更新時，使用者可沿用快取的 three。
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
