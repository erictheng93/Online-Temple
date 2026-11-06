/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 遊戲伺服器 WebSocket 位址；未設定時為離線模式。 */
  readonly VITE_WS_URL?: string
  /** 環境音樂檔 URL（佛樂＋風聲循環 MP3，正式環境放在 R2）；未設定時只有鳥叫與音效。 */
  readonly VITE_AMBIENT_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
