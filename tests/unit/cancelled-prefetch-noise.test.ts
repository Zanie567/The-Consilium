import { expect, it } from 'vitest'
import { isCancelledPrefetchNoise } from '../e2e/helpers/console'

// The e2e console collector tolerates exactly one WebKit artefact: a same-origin Next.js
// prefetch (?_rsc=) cancelled by a navigation. Everything else must stay evidence.
it('tolerates a cancelled same-origin RSC prefetch, whatever base64url characters its hash has', () => {
  for (const hash of ['etKjWzuRnBEOfpE4', '1xxEHUgv-NaMNd1m', 'a_b-c']) {
    expect(isCancelledPrefetchNoise(`/localhost:3200/editorial/articles/cmvjx/edit?_rsc=${hash} due to access control checks.`)).toBe(true)
  }
  expect(isCancelledPrefetchNoise('/localhost:3200/?x=1&_rsc=ab-c due to access control checks.')).toBe(true)
})

it('still reports every other failure', () => {
  for (const message of [
    '/localhost:3200/api/editorial/notifications due to access control checks.', // not a prefetch
    '/evil.example:443/editorial?_rsc=abc due to access control checks.', // not localhost
    '/localhost:3200/editorial?_rsc=abc due to access control checks. extra', // more than the artefact
    '/localhost:3200/editorial?_rsc=ab c due to access control checks.', // malformed token
    'TypeError: Load failed',
    'Error: Forbidden',
  ]) expect(isCancelledPrefetchNoise(message), message).toBe(false)
})
