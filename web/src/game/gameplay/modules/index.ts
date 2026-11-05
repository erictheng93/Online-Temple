import type { GameplayModule } from '../types'
import { demoModule } from './demo'

/** 啟用的玩法模組。玩法定案後在這裡替換。 */
export const gameplayModules: GameplayModule[] = [demoModule]
