/**
 * Image type detection by magic bytes. The browser-supplied MIME type is never
 * trusted: callers read the file's actual bytes.
 */

// Server-side magic-byte signatures for each permitted image format.
// We read the actual file bytes rather than trusting the browser-supplied MIME type.
type Signature = { offset: number; bytes: number[] }

const IMAGE_SIGNATURES: Array<{ mimeType: string; sigs: Signature[] }> = [
  {
    mimeType: 'image/jpeg',
    sigs: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  },
  {
    mimeType: 'image/png',
    sigs: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  },
  {
    mimeType: 'image/gif',
    sigs: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }],
  },
  {
    // WebP: RIFF at bytes 0-3, WEBP at bytes 8-11
    mimeType: 'image/webp',
    sigs: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  },
  {
    // AVIF / HEIF: ISO base media file format - 'ftyp' box at offset 4
    mimeType: 'image/avif',
    sigs: [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }],
  },
]

export function detectImageMimeType(buf: Uint8Array): string | null {
  outer: for (const { mimeType, sigs } of IMAGE_SIGNATURES) {
    for (const { offset, bytes } of sigs) {
      if (buf.length < offset + bytes.length) continue outer
      for (let i = 0; i < bytes.length; i++) {
        if (buf[offset + i] !== bytes[i]) continue outer
      }
    }
    return mimeType
  }
  return null
}
