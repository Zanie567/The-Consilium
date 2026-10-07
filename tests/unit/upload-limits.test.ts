import { describe, it, expect } from 'vitest'
import {
  MAX_ARTICLE_IMAGE_BYTES, MAX_AVATAR_BYTES, MAX_SERVER_UPLOAD_BYTES, MAX_TEAM_PHOTO_BYTES, VERCEL_REQUEST_BODY_LIMIT_BYTES,
} from '@/lib/constants'

describe('server-mediated upload limits fit Vercel', () => {
  it('every cap is the one shared server limit', () => {
    expect(MAX_ARTICLE_IMAGE_BYTES).toBe(MAX_SERVER_UPLOAD_BYTES)
    expect(MAX_AVATAR_BYTES).toBe(MAX_SERVER_UPLOAD_BYTES)
    expect(MAX_TEAM_PHOTO_BYTES).toBe(MAX_SERVER_UPLOAD_BYTES)
  })

  it('leaves room for multipart framing under the platform request-body limit', () => {
    const framing = 64 * 1024 // generous: real framing is a few hundred bytes
    expect(MAX_SERVER_UPLOAD_BYTES + framing).toBeLessThan(VERCEL_REQUEST_BODY_LIMIT_BYTES)
  })
})
