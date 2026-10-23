import { describe, expect, it } from 'vitest'
import {
  bannerHeightClass, coverFramingImageStyle, coverFramingKey, defaultCoverFraming,
  parseCoverFraming, validateCoverFraming, writerMayFrameCover,
} from '@/lib/coverFraming'

const image = 'https://images.example.org/articles/a.jpg'
const frame = { ...defaultCoverFraming(image), fit: 'cover' as const, zoom: 175, focusX: 0, focusY: 100, height: 'tall' as const }

describe('article banner framing', () => {
  it('keeps the existing full-image treatment on articles without settings', () => {
    expect(parseCoverFraming(null, image)).toEqual({
      imageUrl: image, fit: 'contain', zoom: 100, focusX: 50, focusY: 50, height: 'standard',
    })
    expect(coverFramingImageStyle(defaultCoverFraming(image))).toMatchObject({
      objectFit: 'contain', objectPosition: '50% 50%', transform: 'scale(1)',
    })
  })
  it('supports deliberate zoom, focus point and banner height with shared preview/public styles', () => {
    expect(validateCoverFraming(frame)).toEqual(frame)
    expect(parseCoverFraming(JSON.stringify(frame), image)).toEqual(frame)
    expect(coverFramingImageStyle(frame)).toEqual({
      objectFit: 'cover', objectPosition: '0% 100%', transform: 'scale(1.75)', transformOrigin: '0% 100%',
    })
    expect(bannerHeightClass.tall).toContain('h-[')
    expect(bannerHeightClass.compact).not.toBe(bannerHeightClass.standard)
  })
  it('invalidates saved framing when the image is replaced (prevents the wrong crop)', () => {
    const different = 'https://images.example.org/articles/b.jpg'
    expect(parseCoverFraming(JSON.stringify(frame), different)).toEqual(defaultCoverFraming(different))
    expect(parseCoverFraming('invalid-json', image)).toEqual(defaultCoverFraming(image))
  })
  it('rejects unsanitised modes, overly large numbers, nonintegers and malformed JSON', () => {
    expect(validateCoverFraming({ ...frame, fit: 'url(javascript:alert(1))' })).toBeNull()
    expect(validateCoverFraming({ ...frame, zoom: 500 })).toBeNull()
    expect(validateCoverFraming({ ...frame, zoom: 110.5 })).toBeNull()
    expect(validateCoverFraming({ ...frame, zoom: 112 })).toBeNull()
    expect(validateCoverFraming({ ...frame, focusX: -1 })).toBeNull()
    expect(validateCoverFraming({ ...frame, focusY: 101 })).toBeNull()
    expect(validateCoverFraming({ ...frame, height: 'full-screen' })).toBeNull()
    expect(validateCoverFraming({ ...frame, imageUrl: '' })).toBeNull()
    expect(validateCoverFraming(null)).toBeNull()
  })
  it('keeps author permissions scoped to their own editable, unpublished drafts', () => {
    expect(writerMayFrameCover('alice', 'DRAFT', 'alice')).toBe(true)
    expect(writerMayFrameCover('alice', 'REJECTED', 'alice')).toBe(true)
    for (const status of ['PUBLISHED', 'PENDING_REVIEW', 'ARCHIVED', 'SCHEDULED']) {
      expect(writerMayFrameCover('alice', status, 'alice')).toBe(false)
    }
    expect(writerMayFrameCover('alice', 'DRAFT', 'bob')).toBe(false)
  })
  it('names settings per article, avoiding collisions', () => {
    expect(coverFramingKey('articleA')).not.toBe(coverFramingKey('articleB'))
  })
})
