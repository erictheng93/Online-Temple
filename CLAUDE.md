# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

專案規範以 [AGENTS.md](AGENTS.md) 為準（繁體中文撰寫說明與報告、識別字用英文、資源釋放、訊息上限等），本檔不重複。版本與技術決策的唯一來源是 [docs/TECH_STACK.md](docs/TECH_STACK.md)；後端任務與驗收標準在 [docs/BACKEND_TASKS.md](docs/BACKEND_TASKS.md)（使用者實作、Claude 稽核）。

## 狀態

- `web/`：Vite 8 + Vue 3.5 + TypeScript + 直接操作 Three.js 的前端，已可運作。
- `server/`：Rust + Axum 後端尚未建立。多人功能目前以 `web/scripts/mock-server.mjs` 測試，它實作與正式伺服器相同的協定。
- 玩法尚未定義；`gameplay/modules/demo.ts` 只是驗證接線的示範，可整個刪除。

## 指令（皆在 `web/` 執行）

```bash
npm ci
npm run dev                          # http://localhost:5173
npm run typecheck                    # vue-tsc -b
npm test                             # vitest run（src/**/*.test.ts、tools/**/*.test.ts）
npx vitest run src/game/net/net.test.ts        # 單一測試檔
npx vitest run -t "部分測試名稱"                # 依名稱篩選
npm run build                        # 型別檢查 + 建置到 web/dist
npm run mock -- 20                   # mock 伺服器 ws://localhost:8080/ws，20 個機器人
npm run render:ambient               # 離線產生 public/audio/temple-ambient.mp3（不提交 git）
npm run check:ambient -- <音樂網址> <遊戲來源>  # 檢查 R2 上音樂檔的 CORS／Range／快取
```

- 環境變數見 `web/.env.example`：`VITE_WS_URL`（未設定＝離線模式）、`VITE_AMBIENT_URL`（未設定＝沒有佛樂與風聲，建置時會警告）。本機寫在 `web/.env.local`。
- CI（`.github/workflows/web.yml`）：`npm ci` → `typecheck` → `test` → `vite build`，Node 22。
- 無 lint／格式化工具設定。
- 後端建立後，每個 PR 須通過 `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`cargo test`。

## 架構

### GameCore 是唯一擁有者

`web/src/game/GameCore.ts` 建立並擁有所有子系統（`SceneRenderer`、`TempleScene`、`AnimationSystem`、`Players`、`InputController`、`NetworkClient`、`AudioManager`、`ActionRegistry`），負責建立與釋放順序、渲染排程、網路訊息分派，以及推送給 Vue 的 `UiState`。新增子系統時，在 GameCore 建立並在其 dispose 中釋放。

- **Vue ↔ 核心邊界**：Vue（`src/App.vue`、`src/ui/`）只透過 `onUi(UiState)` 接收低頻摘要（內容改變才推送，最多每 250 ms 一次），透過 GameCore 的方法下指令。高頻狀態（玩家位置、Three.js 物件）不放進 Vue 響應式系統。
- **GPU 資源**：geometry／material／texture 透過 `render/ResourceTracker` 的 `track()`／`trackMaterial()` 登記，由 tracker 統一釋放。
- **渲染排程**：依需求繪製（`wake()` 標記 dirty）。移動中以畫質幀率上限繪製，靜止時降到 8／15 FPS，省電模式靜止時完全停止迴圈；背景分頁停止迴圈、暫停 AudioContext、停止送位置。改動任何會讓畫面變化的狀態，記得呼叫 `wake()`。
- **角色繪製**：袍、頭、影子以 InstancedMesh 批次繪製（固定 3 個 draw call），容量 `AVATAR_CAPACITY`（160）須大於最高畫質的可見人數；名牌只顯示最近 12 人。
- **場地配置**：`world/layout.ts` 同時供場景建構與碰撞使用（`OBSTACLES`、`WORLD_BOUNDS`），改場地要兩邊一致。

### 網路協定

- `src/game/net/protocol.ts` 是前後端協定的定義來源（JSON 草案，版本 1）。編碼集中在 `encode()`／`decode()`；`decode()` 負責驗證，新增伺服器訊息時同步擴充型別與驗證。改協定時前端、mock 伺服器與後端在同一個 PR 修改。
- 語意分兩類：`move`／`stop` 可取代（`OutboundQueue` 合併未送出的舊位置）；`action` 需確認（帶 `reqId`，伺服器去重並回 `ack`，重送不重複執行）。
- 伺服器每個 tick 送批次位置 `moves`（`MoveTuple[]`，只含有變動的玩家，上限 `MAX_MOVES_PER_MESSAGE`）。單則訊息上限 `MAX_MESSAGE_BYTES`（16 KB）。
- `NetworkClient` 負責重連（`backoff.ts`）、心跳、送出節流與 `resumeToken` 恢復；渲染頻率與網路送出頻率各自獨立。

### 玩法擴充點

玩法以 `GameplayModule`（`gameplay/types.ts`）加入，不修改渲染、網路或 UI：在 `install(api)` 中以 `api.actions.register()` 註冊動作（動作列、冷卻、動畫、音效、伺服器確認自動接上），`api.animations.registerClip()` 加姿勢、`api.audio.loadSfx()` 加音效、`api.setStat()` 更新 HUD；`install` 回傳的函式須清除全部註冊。模組登記於 `gameplay/modules/index.ts`。`GameplayApi` 刻意保持很小，需要時再擴充。

### 音訊

- 環境音樂（佛樂＋風聲）不在執行時合成：`tools/ambient/score.ts` 是樂譜，`render.ts` 用 `node-web-audio-api` 離線算出可無縫循環的 MP3，正式環境放在 R2，以 HTMLMediaElement（`crossOrigin="anonymous"`）串流後接入 Web Audio。R2 未允許遊戲網域的 CORS 時瀏覽器拒絕載入，遊戲顯示「背景音樂無法載入」提示，只剩鳥叫與音效。部署或更換音樂檔時必須照 docs/TECH_STACK.md「部署檢查」執行 `npm run check:ambient` 並用手機實聽（使用者要求特別留意）。
- 短音效（鐘、木魚、頌缽、鳥叫）由 `AudioManager` 即時合成為 AudioBuffer。
- 靜音或音量為 0 時淡出後暫停 AudioContext 與音樂檔；背景時同靜音。

## 驗證注意

- 前端變更：`npm run typecheck`、`npm test`、`npm run build`；涉及畫面或互動時以 `npm run dev`（多人加 `npm run mock`）在瀏覽器實際確認。
- 效能數據可在遊戲設定開啟「顯示效能資訊」（FPS、CPU 時間、draw call）。目前量測都是桌面 Chromium，非手機實測；容量聲明須附負載條件（見 AGENTS.md）。
- 修改同步或連線生命週期時，用 mock 伺服器驗證斷線重連與多人情境。
