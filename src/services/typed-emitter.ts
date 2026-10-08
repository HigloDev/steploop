/**
 * 极小的类型化事件发射器。
 *
 * 不引入 `events`（RN 运行时不保证存在）也不引入第三方依赖：
 * recorder 需要把样本/气压/状态事件交给 coordinator，而 coordinator 需要在
 * 每轮 owner 变化后丢弃旧一轮的事件。
 */
export class TypedEmitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<(value: never) => void>>()

  on<K extends keyof Events>(event: K, listener: (value: Events[K]) => void): this {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener as (value: never) => void)
    this.listeners.set(event, set)
    return this
  }

  off<K extends keyof Events>(event: K, listener: (value: Events[K]) => void): this {
    this.listeners.get(event)?.delete(listener as (value: never) => void)
    return this
  }

  emit<K extends keyof Events>(event: K, value: Events[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of [...set]) {
      ;(listener as (value: Events[K]) => void)(value)
    }
  }

  removeAllListeners(): void {
    this.listeners.clear()
  }

  listenerCount(event: keyof Events): number {
    return this.listeners.get(event)?.size ?? 0
  }
}
