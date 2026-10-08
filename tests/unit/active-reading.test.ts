import { describe, it, expect } from 'vitest'
import { ActiveReadingClock } from '@/lib/activeReading'
describe('active reading time', () => {
  it('counts five actual minutes only with recent interaction', () => {
    const c = new ActiveReadingClock(0)
    for (let i = 1; i <= 10; i++) c.interact(i * 30000)
    expect(c.tick(300000)).toBe(300)
  })
  it('pauses hidden/unfocused and resumes without counting the gap', () => {
    const c = new ActiveReadingClock(0)
    c.visibility(10000, false)
    expect(c.tick(200000)).toBe(10)
    c.visibility(200000, true)
    c.focus(200000, true)
    expect(c.tick(210000)).toBe(20)
    c.focus(210000, false)
    expect(c.tick(300000)).toBe(20)
    c.focus(300000, true)
    expect(c.tick(305000)).toBe(25)
  })
  it('stops at 60s idle and does not add idle time when activity resumes', () => {
    const c = new ActiveReadingClock(0)
    expect(c.tick(600000)).toBe(60)
    c.interact(600000)
    expect(c.tick(610000)).toBe(70)
  })
  it('is monotonic under backwards time and bounds a visit', () => {
    const c = new ActiveReadingClock(0)
    expect(c.tick(10000)).toBe(10)
    expect(c.tick(9000)).toBe(10)
    for (let i = 1; i < 400; i++) c.interact(i * 30000)
    expect(c.tick(12000000)).toBe(7200)
  })
  it('starts hidden without accumulating until actual focus/activity', () => {
    const c = new ActiveReadingClock(0, false, false)
    expect(c.tick(60000)).toBe(0)
    c.visibility(60000, true)
    c.focus(60000, true)
    expect(c.tick(65000)).toBe(5)
  })
})
