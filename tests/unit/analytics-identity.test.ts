// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { analyticsIdentity } from '@/lib/analyticsIdentity'
import { getCookieConsent } from '@/components/ui/CookieConsent'
beforeEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})
describe('consented analytics identity', () => {
  it('creates no persistent analytics identifier without consent', () => {
    const a = analyticsIdentity()
    expect(a.consent).toBe(false)
    expect(a.readerId).toBeUndefined()
    expect(localStorage.getItem('consilium_analytics_reader')).toBeNull()
    expect(analyticsIdentity().sessionId).toBe(a.sessionId)
  })
  it('has finite 90 day persistence only after acceptance', () => {
    localStorage.setItem('consilium_cookie_consent', 'accepted')
    const a = analyticsIdentity()
    expect(a.readerId).toBeTruthy()
    expect(analyticsIdentity().readerId).toBe(a.readerId)
    const saved = JSON.parse(localStorage.getItem('consilium_analytics_reader')!)
    expect(saved.expires - Date.now()).toBeLessThanOrEqual(90 * 86400000)
  })
  it('removes legacy/current identifier on decline', () => {
    localStorage.setItem('consilium_cookie_consent', 'accepted')
    analyticsIdentity()
    localStorage.setItem('consilium_sid', 'old')
    localStorage.setItem('consilium_cookie_consent', 'declined')
    expect(analyticsIdentity().readerId).toBeUndefined()
    expect(localStorage.getItem('consilium_analytics_reader')).toBeNull()
    expect(localStorage.getItem('consilium_sid')).toBeNull()
  })
  it('rotates expired/malformed identifiers', () => {
    localStorage.setItem('consilium_cookie_consent', 'accepted')
    localStorage.setItem('consilium_analytics_reader', JSON.stringify({ id: 'old', expires: 1 }))
    expect(analyticsIdentity().readerId).not.toBe('old')
  })
  it('fails safely when browser storage is denied', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(getCookieConsent()).toBeNull()
    expect(analyticsIdentity().consent).toBe(false)
    spy.mockRestore()
  })
})
