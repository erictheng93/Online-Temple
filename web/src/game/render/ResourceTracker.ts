import * as THREE from 'three'

type Disposable = { dispose: () => void }

/**
 * GPU 資源擁有者。建立的 geometry／material／texture 都登記在擁有者上，dispose() 一次釋放。
 * 共用資源只登記在一個擁有者，避免重複釋放或漏釋放。
 */
export class ResourceTracker {
  private items = new Set<Disposable>()

  track<T extends Disposable>(resource: T): T {
    this.items.add(resource)
    return resource
  }

  /** 登記 material 及其所有貼圖。 */
  trackMaterial<T extends THREE.Material>(material: T): T {
    this.track(material)
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) this.track(value)
    }
    return material
  }

  dispose(): void {
    for (const r of this.items) r.dispose()
    this.items.clear()
  }
}
