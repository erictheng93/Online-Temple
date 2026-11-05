/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 遊戲伺服器 WebSocket 位址；未設定時為離線模式。 */
  readonly VITE_WS_URL?: string
  /** 環境音錄音 URL（例如 R2 上的檔案）；未設定時使用合成環境音。 */
  readonly VITE_AMBIENT_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
