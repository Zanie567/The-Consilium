import { NextRequest } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { createClient } from '@supabase/supabase-js'
import { ARTICLE_MUTATION_ROLES } from '@/lib/rbac'

// BUG-18: Explicit allowlist of buckets callers may upload to.
// Any value not in this list is rejected outright.
const ALLOWED_BUCKETS = new Set(['article-images', 'avatars'])

// BUG-16: Server-side magic-byte signatures for each permitted image format.
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

function detectImageMimeType(buf: Uint8Array): string | null {
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

export async function POST(request: NextRequest) {
  const user = await getVerifiedSessionUser(ARTICLE_MUTATION_ROLES)
  if (!user) {
    return Response.json(
      { error: 'Only writers and editors may upload files.' },
      { status: 403 }
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl) {
    return Response.json(
      { error: 'Storage not configured: NEXT_PUBLIC_SUPABASE_URL is missing.' },
      { status: 503 }
    )
  }

  if (!supabaseKey) {
    return Response.json(
      {
        error:
          'Storage not configured: add SUPABASE_SERVICE_ROLE_KEY to your environment variables. ' +
          'Find it in Supabase Dashboard -> Project Settings -> API -> service_role.',
      },
      { status: 503 }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const bucketParam = (formData.get('bucket') as string | null) ?? 'article-images'

    if (!file) {
      return Response.json({ error: 'No file provided.' }, { status: 400 })
    }

    // BUG-18: validate bucket against the allowlist
    if (!ALLOWED_BUCKETS.has(bucketParam)) {
      return Response.json(
        { error: `Invalid bucket. Allowed values: ${[...ALLOWED_BUCKETS].join(', ')}.` },
        { status: 400 }
      )
    }

    if (file.size > 10 * 1024 * 1024) {
      return Response.json({ error: 'File too large (max 10 MB).' }, { status: 400 })
    }

    // Read the file into a buffer so we can inspect its magic bytes
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    // BUG-16: verify actual file content rather than trusting the browser MIME type
    const detectedType = detectImageMimeType(bytes)
    if (!detectedType) {
      return Response.json(
        {
          error:
            'File type not permitted. Allowed formats: JPEG, PNG, GIF, WebP, AVIF.',
        },
        { status: 400 }
      )
    }

    // Use the server-verified MIME type, not file.type
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filename = `${Date.now()}-${safeName}`

    const { error: uploadError } = await supabase.storage
      .from(bucketParam)
      .upload(filename, buffer, { contentType: detectedType, upsert: false })

    if (uploadError) {
      console.error('[upload] Supabase error:', uploadError)
      return Response.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500 }
      )
    }

    const { data: urlData } = supabase.storage.from(bucketParam).getPublicUrl(filename)

    return Response.json({ url: urlData.publicUrl }, { status: 201 })
  } catch (err) {
    console.error('[upload] Unexpected error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Upload failed unexpectedly.' },
      { status: 500 }
    )
  }
}
