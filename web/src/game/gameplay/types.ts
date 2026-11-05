import type { AnimationSystem } from '../anim/AnimationSystem'
import type { AudioManager } from '../audio/AudioManager'
import type { Emitter } from '../core/Emitter'
import type { ActionRegistry } from './ActionRegistry'

export interface GameEvents extends Record<string, unknown> {
  /** 任一玩家（含自己）執行了動作。local 表示是本機玩家。 */
  actionPerformed: { playerId: string; actionId: string; local: boolean; x: number; z: number }
  playerJoined: { id: string; name: string }
  playerLeft: { id: string }
}

/**
 * 玩法模組可使用的介面。刻意保持很小：玩法定案時再依需求擴充，不預先暴露內部系統。
 */
export interface GameplayApi {
  actions: ActionRegistry
  animations: Pick<AnimationSystem, 'registerClip'>
  audio: Pick<AudioManager, 'loadSfx' | 'play'>
  events: Pick<Emitter<GameEvents>, 'on'>
  /** 在 HUD 顯示或更新一項數值；value 為 null 時移除。 */
  setStat(key: string, label: string, value: string | number | null): void
  /** 觸發場景中的互動物件效果（目前只有鐘）。 */
  scene: { swingBell(): void }
  /** 自己的玩家座標。 */
  localPosition(): { x: number; z: number }
}

/**
 * 玩法模組：install 時註冊動作、動畫、音效與事件，回傳的函式負責全部清除。
 */
export interface GameplayModule {
  id: string
  install(api: GameplayApi): () => void
}
