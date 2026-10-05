// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { AnimateIn, StaggerContainer, StaggerItem } from '@/components/ui/AnimateIn'
const { preference } = vi.hoisted(() => ({ preference: { reduced: false } }))
vi.mock('framer-motion', async () => ({ ...await vi.importActual<typeof import('framer-motion')>('framer-motion'), useReducedMotion: () => preference.reduced }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); preference.reduced = false })
it('reduced motion hydrates the same reveal and stagger HTML rendered on the server', async () => {
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
 vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
 const view = <AnimateIn><StaggerContainer><StaggerItem><h1>Representative content</h1></StaggerItem></StaggerContainer></AnimateIn>
 const host = document.createElement('div'); document.body.append(host)
 host.innerHTML = renderToString(view)
 preference.reduced = true
 const errors: unknown[][] = []
 vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args))
 const recoverable: Error[] = []
 let root!: ReturnType<typeof hydrateRoot>
 await act(async () => { root = hydrateRoot(host, view, { onRecoverableError: error => recoverable.push(error as Error) }) })
 try { expect(recoverable).toEqual([]); expect(errors).toEqual([]) }
 finally { await act(async () => root.unmount()); host.remove() }
})
