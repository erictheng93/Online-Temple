import { describe, expect, it } from 'vitest'
import { resolveCollisions, stepMover, type MoveConfig } from './movement'
import { HALL } from './layout'
import { HALL_STATUES, ZONES, ZONE_IDS, entryCamera, isZoneId, portalApproach, portalAt, portalForTap } from './zones'

const cfgFor = (id: keyof typeof ZONES): MoveConfig => ({ speed: 3.2, bounds: ZONES[id].bounds, obstacles: ZONES[id].obstacles })

describe('zones', () => {
  it('出生點與出入口落點都在可走範圍、不在障礙物或出入口內（避免來回瞬移）', () => {
    for (const id of ZONE_IDS) {
      const zone = ZONES[id]
      const poses = [zone.spawn, ...ZONE_IDS.flatMap((other) => ZONES[other].portals.filter((p) => p.to === id).map((p) => p.spawn))]
      for (const pose of poses) {
        expect(resolveCollisions(pose.x, pose.z, cfgFor(id)), `${id} 落點被推出障礙物`).toEqual({ x: pose.x, z: pose.z })
        expect(portalAt(id, pose.x, pose.z), `${id} 落點在出入口內`).toBeNull()
      }
    }
  })

  it('從庭院出生點直走向殿門會進入殿內出入口；殿內走回門口會觸發回庭院', () => {
    for (const [id, target] of [['courtyard', { x: 0, z: -20 }], ['hall', { x: 0, z: 20 }]] as const) {
      const from = id === 'courtyard' ? ZONES.hall.portals[0]!.spawn : ZONES.hall.spawn
      const s = { x: from.x, z: from.z, heading: 0, target }
      let hit = null
      for (let i = 0; i < 200 && !hit; i++) {
        stepMover(s, { dirX: 0, dirZ: 0 }, 0.05, cfgFor(id))
        if (!s.target) s.target = target // 撞到障礙物會放棄目標，重新指定以模擬持續往前走
        hit = portalAt(id, s.x, s.z)
      }
      expect(hit?.to).toBe(id === 'courtyard' ? 'hall' : 'courtyard')
    }
  })

  it('神像方位：以神明為主體，觀音在主佛左手邊（+x，龍邊），關聖帝君在右手邊（-x，虎邊）', () => {
    expect(HALL_STATUES.buddha.x).toBe(0)
    expect(HALL_STATUES.guanyin.x).toBeGreaterThan(0)
    expect(HALL_STATUES.guangong.x).toBeLessThan(0)
  })

  it('點擊主殿建築會導向殿門，且殿門的走近點可抵達並觸發入口', () => {
    const portal = portalForTap('courtyard', 0, -12)
    expect(portal?.to).toBe('hall')
    const approach = resolveCollisions(portalApproach(portal!).x, portalApproach(portal!).z, cfgFor('courtyard'))
    expect(portalAt('courtyard', approach.x, approach.z)?.to).toBe('hall')
    expect(portalForTap('courtyard', 0.6, -63.7)?.to).toBe('hall') // 實測：點屋頂時射線落在很遠的後方
    expect(portalForTap('courtyard', 0, 5)).toBeNull()
  })

  it('出殿：還原進殿前的庭院鏡頭（距離限制在庭院範圍內）', () => {
    const exit = ZONES.hall.portals[0]!.spawn
    const saved = { yaw: 0.3, pitch: 0.5, distance: 99 }
    expect(entryCamera('courtyard', exit, saved, 0.4)).toEqual({ yaw: 0.3, pitch: 0.5, distance: ZONES.courtyard.camera.max })
  })

  it('出殿且沒有紀錄時，鏡頭在庭院一側看向主殿，不會被主殿擋住', () => {
    const exit = ZONES.hall.portals[0]!.spawn // 角色面朝庭院（heading 0）站在殿門前
    const { yaw, pitch, distance } = entryCamera('courtyard', exit, undefined, 0.4)
    const camZ = exit.z + Math.cos(yaw) * Math.cos(pitch) * distance
    expect(camZ).toBeGreaterThan(exit.z) // 鏡頭在庭院一側
    // 舊做法（鏡頭放在角色背後）會讓鏡頭落進主殿建築裡
    const oldCamZ = exit.z + Math.cos(exit.heading + Math.PI) * Math.cos(pitch) * distance
    expect(oldCamZ).toBeGreaterThan(HALL.minZ)
    expect(oldCamZ).toBeLessThan(HALL.maxZ)
  })

  it('進殿：一律放在角色背後看向神龕，不還原', () => {
    const enter = ZONES.courtyard.portals[0]!.spawn
    const cam = entryCamera('hall', enter, { yaw: 1, pitch: 1, distance: 1 }, 0.4)
    expect(cam.yaw).toBeCloseTo(enter.heading + Math.PI)
    expect(cam.distance).toBe(ZONES.hall.camera.distance)
  })

  it('出殿落點與殿門入口保持至少 1 公尺緩衝，避免立刻再次進殿', () => {
    const exit = ZONES.hall.portals[0]!.spawn
    const door = ZONES.courtyard.portals[0]!.rect
    expect(exit.z - door.maxZ).toBeGreaterThanOrEqual(1)
  })

  it('isZoneId 只接受已知場景', () => {
    expect(isZoneId('hall')).toBe(true)
    expect(isZoneId('roof')).toBe(false)
    expect(isZoneId(undefined)).toBe(false)
  })
})
