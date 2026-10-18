// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ViewCounter } from '@/components/ui/ViewCounter'
vi.mock('@/lib/activeReading', () => ({ActiveReadingClock:class {tick(){return 0} interact(){} visibility(){} focus(){}}}))
const identity = vi.hoisted(() => vi.fn(() => ({sessionId:'retry-fixture',consent:false})))
vi.mock('@/lib/analyticsIdentity', () => ({analyticsIdentity:identity}))
afterEach(() => {cleanup();vi.useRealTimers();vi.unstubAllGlobals()})
it('retries unacknowledged views even when reading time has not advanced, then suppresses unchanged acknowledged events', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn().mockResolvedValueOnce({ok:false}).mockResolvedValue({ok:true})
  vi.stubGlobal('fetch',fetcher)
  render(<ViewCounter articleId="a" />)
  await act(async () => {})
  await act(async () => {await vi.advanceTimersByTimeAsync(30000)})
  expect(fetcher).toHaveBeenCalledTimes(2)
  const first = JSON.parse(fetcher.mock.calls[0][1].body), second = JSON.parse(fetcher.mock.calls[1][1].body)
  expect(second.visitId).toBe(first.visitId)
  expect(second.sessionId).toBe(first.sessionId)
  await act(async () => {await vi.advanceTimersByTimeAsync(30000)})
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('flushes a consent change after an in-flight event without waiting for a heartbeat', async () => {
  vi.useFakeTimers()
  let resolve!: (value: {ok:boolean}) => void
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(r => {resolve=r})).mockResolvedValue({ok:true})
  vi.stubGlobal('fetch',fetcher)
  render(<ViewCounter articleId="a" />)
  await act(async () => {window.dispatchEvent(new Event('consilium-consent-change'))})
  expect(fetcher).toHaveBeenCalledTimes(1)
  await act(async () => {resolve({ok:true})})
  expect(fetcher).toHaveBeenCalledTimes(2)
})
