# 技術選型與執行限制

記錄日期：2026-11-05。狀態：技術方向已確認，應用程式尚未建立。

## 產品與工程優先順序

開發手機與 PC 瀏覽器可直接進入的多人靜心遊戲，以《山寺》（Sansatemple）類型為參考。優先考量執行時資源消耗、運行效率與穩定性，並將手機發熱、耗電、聲音體驗與首次可操作時間列為主要品質指標。

3,000～5,000 人同時在線是產品容量目標；目前未確認是全站總在線或單一房間彼此可見，相關同步設計先採可分房／分區的工作假設。容量目標尚未經過實測。

## 已確認技術棧

| 層級 | 選擇 | 狀態 |
| --- | --- | --- |
| 前端建置 | Vite | 版本於建立骨架時選定 |
| UI | Vue、TypeScript、Composition API | Vue 版本見下節 |
| 元件語法 | `<script setup lang="ts">` | 已確認 |
| 3D | Vanilla Three.js | 直接操作 Three.js，無 TresJS 或 R3F 整合層 |
| 後端 | Rust | Web 框架在 Axum／Actix-web 中擇一，尚未定案 |
| 資料庫 | PostgreSQL | 版本於後端實作時選定 |
| 部署 | Dokploy、Linux VPS | 保留使用者選定方式 |
| 物件儲存 | Cloudflare R2 | 模型、貼圖與音訊等素材 |
| Phase 2 | Tauri Mobile | 尚未開始實作 |

目前尚未固定 Node.js、npm、TypeScript、Vite、Three.js、Rust、PostgreSQL 與 Tauri 的版本。建立對應骨架時選擇相容且受支援的穩定版本，再記錄工具鏈與依賴鎖定結果。

## Vue 版本與安裝規範

本專案採用 **Vue 3.5.44**。這是本次確認的穩定版本基準；後續即使上游發布新版本，也不會自動改變本專案的選擇。

建立前端 `package.json` 後，在前端套件目錄執行：

```bash
npm install --save-exact vue@3.5.44
```

預期 `package.json` 的相依套件包含：

```json
{
  "dependencies": {
    "vue": "3.5.44"
  }
}
```

以上是片段，需合併到骨架產生的完整檔案。版本使用精確字串，不加 `^` 或 `~`。若骨架直接宣告 `@vue/compiler-sfc`，將它與 Vue 固定為相同版本。

提交 `package.json` 與 `package-lock.json`；CI 與可重現安裝使用：

```bash
npm ci
```

安裝完成後可用下列指令檢查實際版本：

```bash
npm ls vue
```

Vue 單檔元件使用：

```vue
<script setup lang="ts">
import { ref } from 'vue'

const soundEnabled = ref(false)
</script>

<template>
  <button type="button" @click="soundEnabled = !soundEnabled">
    {{ soundEnabled ? '關閉聲音' : '開啟聲音' }}
  </button>
</template>
```

此範例只展示元件語法與 UI 狀態，實際音訊由 AudioManager 處理。以上安裝與檢查指令尚未在本專案執行，因為前端骨架尚未建立。

## 前端邊界

Vue 管理選單、音量設定、房間資訊、個人計數與連線提示。獨立的 TypeScript 遊戲核心管理以下工作：

| 模組責任 | 工作 |
| --- | --- |
| SceneRenderer | Three.js 場景、鏡頭、畫質與渲染排程 |
| AnimationSystem | 角色動作、插值與動畫更新 |
| NetworkClient | WebSocket、訊息編解碼、重連與狀態恢復 |
| AudioManager | 長音軌、短音效、音量與暫停恢復 |

這些是建議的責任邊界，尚不是現存檔名或 API。高頻玩家狀態直接供遊戲核心使用，UI 只訂閱必要的低頻摘要。

直接使用 Three.js 的目的是控制高頻更新與依賴邊界；它不保證在相同場景下比所有封裝更快。效果須由相同素材、畫質、裝置與互動負載的量測判斷。

## 載入、渲染與音訊方向

- 首次只載入基本場景、自己的角色與必要互動；其他玩家及非必要素材分批加入。
- 將下載、模型解碼、物件建立、貼圖上傳與 shader 編譯分開量測。
- 手機先以穩定 30 FPS 為調校起點，限制繪製總像素，提供可調整畫質；實際門檻待裝置測試後決定。
- 使用烘焙光照、共用材質與幾何，限制動態陰影、後製與完整骨架動畫數量；遠景可採簡化模型或 sprite。
- 畫面靜止時停止或降低重繪；持續動畫仍需對應的繪製頻率。聲音播放與 3D 重繪分開管理。
- 背景時暫停繪製，依產品需求降低網路活動；恢復前景後校正動畫時間與房間狀態，處理 WebGL context loss。
- 長誦經與環境音優先評估 HTMLMediaElement；短音效使用 Web Audio buffer。使用者操作後啟用播放，提供獨立音量與淡入淡出。
- 共用素材採明確的資源擁有權；離開場景時釋放不再使用的 GPU、音訊及連線資源。

以上為初始工程方向，尚非經過驗證的效能保證。

## 多人同步方向

瀏覽器使用原生 WebSocket 封裝，渲染選型與連線協定保持獨立。Rust 伺服器確認座位、房間加入結果及操作合法性。

- 分房或分區訂閱，控制每位玩家接收的其他玩家數量。
- 移動時按需要更新位置；停止移動後停止持續重送相同座標。
- 禮佛等動作傳送動作類型與開始時間，由各客戶端播放動畫。
- 初次加入傳送快照，之後傳送差異；重連時取得可恢復的一致狀態。
- 設定訊息大小、操作頻率與每連線佇列上限；尚未送出的過期位置可合併。
- 需要確認的操作與可取代狀態分開處理，避免重試產生重複副作用。
- JSON 或二進位編碼、位置量化、更新頻率依實測決定；先控制廣播範圍，再優化封包。

PostgreSQL 儲存持久資料，避免每個位置或動畫更新都寫入資料庫。資料庫連線池大小依主機與查詢負載調校，不依在線玩家數逐一建立連線。

## VPS 與部署限制

| 項目 | 使用者提供規格 |
| --- | --- |
| 節點 | Linode Tokyo |
| CPU | 1 vCPU；Shared／Dedicated 類型未提供 |
| RAM | 2 GiB |
| 儲存 | 50 GB SSD |
| 每月流量額度 | 2 TB |
| 出站頻寬 | 最高 2 Gbps |
| 入站頻寬 | 未提供 |

保留 Dokploy 作為選定部署工具。這台主機同時執行作業系統、Dokploy、代理、遊戲服務與 PostgreSQL 時餘裕有限；文件不宣稱已能承載 3,000～5,000 名活躍玩家。正式承載量須以整套部署環境壓測判定。

建置放在 CI，主機接收成品。設定日誌輪替、舊映像清理、資料庫備份與服務資源監控。單台主機故障或維護會影響所有連線，部署與重連流程必須納入驗收；單機配置不提供高可用性。

R2 使用自訂網域與快取提供素材，設定必要的 CORS 與版本化快取策略；WebSocket 狀態仍由 VPS 傳出。入站埠速與出站額度是不同條件，2 Gbps 也不代表整月可以持續以該速率傳送。

### 流量預算範例

假設 2 TB 為十進位、每月 30 天，並把全部額度分配給遊戲出站資料：

| 在線情境 | 每玩家平均可用出站資料 |
| --- | --- |
| 3,000 人整月持續在線 | 約 257 bytes/s |
| 5,000 人整月持續在線 | 約 154 bytes/s |
| 每天 8 小時有 5,000 人，其餘時間零流量 | 約 463 bytes/s |

公式：`每玩家 bytes/s = 2,000,000,000,000 / 每月總玩家在線秒數`。上述數字尚未扣協定、心跳、重連與其他請求，實際需預留餘額。

另一個假設：`5,000 接收者 × 30 名被觀察玩家 × 5 次/s × 32 bytes = 24 MB/s = 192 Mbps`。若此負載持續，約 23 小時就會使用 2 TB，尚未計協定開銷。這是流量算例，不是系統壓測結果。

## Phase 2：Tauri Mobile

沿用前端遊戲核心，以 Tauri 封裝 Android／iOS 應用程式。Tauri 使用平台 WebView，Three.js 仍在 WebView 執行；封裝不保證降低 GPU 負載、發熱或耗電。

進入 Phase 2 前，需先驗證 WebView 的圖形相容性、背景／前景恢復、音訊中斷、素材快取與弱網路重連。核心素材可評估隨應用程式分發，活動素材仍由 R2 提供。

## 容量與品質驗證

壓測需區分總連線、活躍玩家、同時移動／操作比例與每人訂閱人數。負載產生器放在外部機器，正式部署上的 PostgreSQL、Dokploy 與代理一併納入測試。

至少記錄 CPU、RSS、可用記憶體、訊息佇列長度、出站流量、斷線率、伺服器處理時間與客戶端操作延遲；包含持續運行、弱網路、慢速接收者及大量重連情境。

手機實測包含首次可操作時間與連續遊玩至少 20～30 分鐘後的幀時間、耗電與發熱；以固定裝置、亮度、音量及網路條件比較。通過標準在第一次實測後依產品需求制定。尚未執行上述驗證。

## 參考資料

- [Vue 3.5.44 發布紀錄](https://github.com/vuejs/core/releases/tag/v3.5.44)
- [Vue 3.5.44 套件資料](https://registry.npmjs.org/vue/3.5.44)
- [Vue 進階響應式 API](https://vuejs.org/api/reactivity-advanced.html)
- [Three.js 按需渲染](https://threejs.org/manual/pages/rendering-on-demand.html)
- [Web Audio 實務](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
- [Dokploy 安裝要求](https://docs.dokploy.com/docs/core/installation)
- [Linode 網路流量說明](https://techdocs.akamai.com/cloud-computing/docs/network-transfer-usage-and-costs)
- [R2 自訂網域與快取](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Tauri WebView 版本](https://v2.tauri.app/reference/webview-versions/)
