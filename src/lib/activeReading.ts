/** Monotonic active time: visible, focused and interacted within 60s. */
export class ActiveReadingClock {
  private last: number
  private activity: number
  private milliseconds = 0
  private visible: boolean
  private focused: boolean
  constructor(now: number, visible = true, focused = true) {
    this.last = now
    this.activity = now
    this.visible = visible
    this.focused = focused
  }
  tick(now: number): number {
    const end = Math.max(this.last, now)
    if (this.visible && this.focused)
      this.milliseconds += Math.max(0, Math.min(end, this.activity + 60000) - this.last)
    this.last = end
    return Math.min(7200, Math.floor(this.milliseconds / 1000))
  }
  interact(now: number) {
    this.tick(now)
    this.activity = Math.max(this.last, now)
  }
  visibility(now: number, visible: boolean) {
    this.tick(now)
    this.visible = visible
  }
  focus(now: number, focused: boolean) {
    this.tick(now)
    this.focused = focused
    if (focused) this.activity = now
  }
}
export const ENGAGED_READ_SECONDS = 300
export const FIVE_MINUTE_READ_SECONDS = 300
