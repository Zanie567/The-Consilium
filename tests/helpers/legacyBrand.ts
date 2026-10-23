import { createHash } from 'node:crypto'
import sharp from 'sharp'

/**
 * Fingerprints of the obsolete branding, so tests can prove it is not being
 * served without keeping the artwork itself in the deployable tree.
 *
 *   logo     the cream circular seal formerly at public/logo.png — the image
 *            X/Twitter showed for every shared link until October 2026
 *   dome     the cream dome-and-book illustration formerly at
 *            public/apple-icon.png (shadowed by src/app/apple-icon.png, unused)
 *
 * Both survive in Git history (e.g. `git show 3841f64:public/logo.png`).
 */
export const LEGACY_BRAND = [
  {
    name: 'legacy cream seal (old /logo.png)',
    sha256: 'deb417b35b462bc43d887af7b4d7d5b7cea0ccbfc4d671667616e478cfaa467c',
    dhash: '71f0cc9696cce871',
  },
  {
    name: 'legacy cream dome illustration (old public/apple-icon.png)',
    sha256: '97cf7869a748cba1001d73b2b111ab7d4afb572b2972c3948fa24bbdf8cff60b',
    dhash: '52b2696c6ceccaf0',
  },
] as const

/**
 * Hamming distance at or below which an image counts as a copy. Resized and
 * JPEG-recompressed copies of the old seal measured 1–3; the nearest unrelated
 * image in the repository (a team photo) measured 13, the current emblem 14.
 */
export const LEGACY_MATCH_DISTANCE = 6

export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** 64-bit difference hash: survives renaming, resizing and recompression. */
export async function dhash(bytes: Buffer): Promise<string> {
  const px = await sharp(bytes).flatten({ background: '#ffffff' }).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
  let hex = ''
  for (let y = 0; y < 8; y++) {
    for (let half = 0; half < 2; half++) {
      let nibble = 0
      for (let x = half * 4; x < half * 4 + 4; x++) nibble = (nibble << 1) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1 : 0)
      hex += nibble.toString(16)
    }
  }
  return hex
}

function hamming(a: string, b: string): number {
  let n = 0
  for (let i = 0; i < a.length; i++) {
    for (let v = parseInt(a[i], 16) ^ parseInt(b[i], 16); v; v >>= 1) n += v & 1
  }
  return n
}

/** The legacy design this image is a copy of, or null. */
export async function legacyMatch(bytes: Buffer): Promise<string | null> {
  const digest = sha256(bytes)
  const hash = await dhash(bytes)
  const hit = LEGACY_BRAND.find((l) => l.sha256 === digest || hamming(l.dhash, hash) <= LEGACY_MATCH_DISTANCE)
  return hit?.name ?? null
}
