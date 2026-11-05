# 線上靜心遊戲

以《山寺》（Sansatemple）類型為參考的多人網頁遊戲，優先提供快速進入、低負擔互動與安靜共處的體驗。專案正式名稱與玩法細節尚未決定。

## 目前狀態

本目錄目前完成文件初始化，尚未建立前後端程式骨架、安裝套件或設定部署。尚無可執行的開發、建置與測試指令。

## 文件入口

- [技術選型與執行限制](docs/TECH_STACK.md)：已確認技術、Vue 版本、前端架構、VPS 容量條件與 Phase 2。
- [Codex 專案指引](AGENTS.md)：後續開發應遵循的規範。

## 已確認方向

前端採用 Vite、Vue、TypeScript 與 Vanilla Three.js；Vue 固定版本與安裝方式以[技術文件](docs/TECH_STACK.md#vue-版本與安裝規範)為準。

後端採用 Rust，框架在 Axum 與 Actix-web 中擇一；資料庫使用 PostgreSQL；部署使用 Dokploy 與 Linux VPS；素材存放 Cloudflare R2。Phase 2 規劃使用 Tauri Mobile。

3,000～5,000 人同時在線為容量目標，尚未經過實測，也尚未確定是全站總在線或單一房間人數。

## 下一個實作階段

建立前端骨架並固定 Vue 版本，再製作最小場景與聲音互動。開始後端實作時選定一個 Rust Web 框架，逐步加入多人同步，透過實際負載測試決定正式承載量。
