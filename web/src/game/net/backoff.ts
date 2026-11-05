/**
 * 指數退避加完整抖動（full jitter）。伺服器重啟時，數千個客戶端的重連時間會分散開，避免重連突波。
 * random 可注入，方便測試。
 */
export function backoffDelay(
  attempt: number,
  baseMs = 500,
  maxMs = 30_000,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt))
  return Math.floor(random() * ceiling)
}
