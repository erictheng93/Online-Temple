import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { loadEnv, type Plugin } from 'vite'

/** 正式建置時若沒有設定環境音樂網址，建置輸出印出警告：遊戲會只剩鳥叫與音效，玩家端不會有任何錯誤提示。 */
const warnMissingAmbient = (): Plugin => ({
  name: 'warn-missing-ambient',
  apply: 'build',
  configResolved(config) {
    const env = loadEnv(config.mode, config.root, 'VITE_')
    if (!env.VITE_AMBIENT_URL) {
      config.logger.warn(
        '\n[警告] 未設定 VITE_AMBIENT_URL：這次建置沒有佛樂與風聲。正式部署請指向 R2 上的音樂檔，並以 npm run check:ambient 確認。\n',
      )
    }
  },
})

export default defineConfig({
  plugins: [vue(), warnMissingAmbient()],
  build: {
    target: 'es2022',
    // three 核心約 585 kB（gzip 約 146 kB，2026-11-06 加入殿內場景後），已獨立快取；超過 600 kB 再檢查是否誤引入額外模組。
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // three 核心單獨成塊：遊戲程式碼更新時，使用者可沿用快取的 three。
        // examples（GLTFLoader 等）不併進核心，維持動態 import 各自按需載入。
        manualChunks: (id) => (id.includes('node_modules/three/build/') ? 'three' : undefined),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
})
