// 上傳環境音樂檔到 R2 後執行，確認瀏覽器真的能播放：
//   npm run check:ambient -- <音樂檔網址> <遊戲網站來源>
//   例：npm run check:ambient -- https://assets.example.com/audio/temple-ambient-v1.mp3 https://temple.example.com
//
// 檢查項目：
// 1. 網址回 200，Content-Type 為音訊。
// 2. CORS：回應的 Access-Control-Allow-Origin 允許遊戲來源。缺少時瀏覽器拒絕載入（前端設了 crossOrigin）。
// 3. Range：回 206 Partial Content。iOS Safari 播放媒體需要支援分段讀取。
// 4. Cache-Control：建議長期快取（檔名含版本號，更新時換檔名）。
const [url, origin] = process.argv.slice(2)
if (!url || !origin) {
  console.error('用法：npm run check:ambient -- <音樂檔網址> <遊戲網站來源，例如 https://temple.example.com>')
  process.exit(2)
}

const results = []
const check = (ok, label, detail) => results.push({ ok, label, detail })

try {
  const full = await fetch(url, { method: 'HEAD', headers: { Origin: origin } })
  const type = full.headers.get('content-type') ?? ''
  check(full.status === 200, 'HTTP 200', `狀態 ${full.status}`)
  check(/^audio\//.test(type), 'Content-Type 為音訊', type || '（無）')

  const acao = full.headers.get('access-control-allow-origin')
  check(acao === '*' || acao === origin, 'CORS 允許遊戲來源', acao ? `Access-Control-Allow-Origin: ${acao}` : '缺少 Access-Control-Allow-Origin（瀏覽器會拒絕載入）')

  const ranged = await fetch(url, { headers: { Origin: origin, Range: 'bytes=0-1' } })
  check(ranged.status === 206, '支援 Range（iOS Safari 需要）', `狀態 ${ranged.status}`)
  await ranged.body?.cancel()

  const cache = full.headers.get('cache-control') ?? ''
  const maxAge = Number(/max-age=(\d+)/.exec(cache)?.[1] ?? 0)
  check(maxAge >= 86_400, 'Cache-Control 長期快取（建議）', cache || '（無）')
} catch (err) {
  check(false, '連線', String(err))
}

for (const r of results) console.log(`${r.ok ? '✔' : '✘'} ${r.label}：${r.detail}`)
// 快取只是建議，不影響結果；其他任一項失敗即回傳非零。
const failed = results.filter((r) => !r.ok && !r.label.includes('建議'))
console.log(failed.length ? `\n${failed.length} 項未通過，玩家將聽不到佛樂。` : '\n全部通過。仍請用手機實際聽一次。')
process.exit(failed.length ? 1 : 0)
