'use client'

import { useEffect } from 'react'

/**
 * Hardens the View Transitions API so it can never throw the
 * "InvalidStateError: Transition was aborted because of invalid state"
 * exception that was firing on navigation. Three guards, matching the three
 * ways the API blows up on a client-routed app:
 *
 *   1. Feature-detect — no-op where startViewTransition is unsupported.
 *   2. Cancel in-flight — a navigation that starts while a previous transition
 *      is still capturing throws synchronously. We detect the in-flight
 *      transition and apply the DOM update directly instead of starting an
 *      overlapping one.
 *   3. Await readiness safely — when a transition is superseded its `ready`/
 *      `finished` promises reject with InvalidStateError. Unhandled, those
 *      surface as console errors, so we attach silent catches and a global
 *      unhandledrejection guard swallows any that slip through Next's router.
 */
export function ViewTransitionGuard() {
  useEffect(() => {
    const doc = document as Document & { __vtPatched?: boolean; __vtActive?: boolean }
    if (typeof doc.startViewTransition !== 'function' || doc.__vtPatched) return

    const native = doc.startViewTransition.bind(doc)
    type VT = ReturnType<typeof native>
    doc.__vtPatched = true

    const noop = (): VT =>
      ({
        ready: Promise.resolve(),
        finished: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        skipTransition: () => {},
        types: new Set<string>(),
      }) as unknown as VT

    // The update arg can be a callback or an options object ({ update }).
    const runUpdate = (cb: unknown) => {
      try {
        if (typeof cb === 'function') void (cb as () => unknown)()
        else if (cb && typeof (cb as { update?: unknown }).update === 'function') {
          void (cb as { update: () => unknown }).update()
        }
      } catch {
        /* update errors are the caller's concern, not the guard's */
      }
    }

    const guarded = ((cb?: Parameters<typeof native>[0]) => {
      if (doc.__vtActive) {
        // A transition is already running — a second, overlapping one is what
        // throws. Apply the DOM update directly and skip the animation.
        runUpdate(cb)
        return noop()
      }
      try {
        doc.__vtActive = true
        const t = native(cb)
        t.ready?.catch(() => {})
        t.updateCallbackDone?.catch(() => {})
        t.finished
          ?.catch(() => {})
          .finally(() => {
            doc.__vtActive = false
          })
        return t
      } catch (err) {
        doc.__vtActive = false
        runUpdate(cb)
        if ((err as { name?: string } | null)?.name === 'InvalidStateError') return noop()
        throw err
      }
    }) as typeof doc.startViewTransition

    doc.startViewTransition = guarded

    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason as { name?: string; message?: string } | undefined
      if (
        reason?.name === 'InvalidStateError' ||
        /Transition was aborted/i.test(reason?.message ?? '')
      ) {
        e.preventDefault()
      }
    }
    window.addEventListener('unhandledrejection', onRejection)

    return () => {
      if (doc.startViewTransition === guarded) doc.startViewTransition = native
      doc.__vtPatched = false
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
