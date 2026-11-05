import type { GameplayModule } from '../types'

/**
 * 示範模組：只用來驗證動作列、動畫、音效與 HUD 數值的接線。玩法定案後整個刪除或替換，
 * 並在 src/game/gameplay/modules/index.ts 移除登記。
 */
export const demoModule: GameplayModule = {
  id: 'demo',
  install(api) {
    let count = 0

    const off = [
      api.actions.register({
        id: 'bow',
        label: '合十',
        glyph: '🙏',
        cooldownMs: 2500,
        animation: 'bow',
        durationMs: 2200,
        locksMovement: true,
        sound: 'wood',
        onConfirmed: () => api.setStat('demo.bows', '合十次數', ++count),
      }),
      api.actions.register({
        id: 'bowl',
        label: '頌缽',
        glyph: '◎',
        cooldownMs: 6000,
        animation: 'kneel',
        durationMs: 3000,
        locksMovement: true,
        sound: 'bowl',
      }),
      api.actions.register({
        id: 'bell',
        label: '敲鐘',
        glyph: '🔔',
        cooldownMs: 8000,
        animation: 'nod',
        durationMs: 1200,
        sound: 'bell',
      }),
      // 任何玩家敲鐘時，鐘都會擺動。
      api.events.on('actionPerformed', (e) => {
        if (e.actionId === 'bell') api.scene.swingBell()
      }),
    ]

    return () => {
      off.forEach((fn) => fn())
      api.setStat('demo.bows', '', null)
    }
  },
}
