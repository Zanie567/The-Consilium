import { prisma } from '@/lib/prisma'
import sharp from 'sharp'
import { randomUUID } from 'node:crypto'
import { queueArticleImageCleanup, articleImagePath } from '@/lib/articleImageStorage'
import { NextResponse, NextRequest } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { createClient } from '@supabase/supabase-js'
import { ALL_ROLES, ARTICLE_MUTATION_ROLES } from '@/lib/rbac'
import type { Role } from '@prisma/client'
import { MAX_AVATAR_BYTES } from '@/lib/constants'
import { detectImageMimeType } from '@/lib/imageSniff'

// Explicit allowlist of buckets callers may upload to.
// Any value not in this list is rejected outright.
const ALLOWED_BUCKETS = new Set(['article-images', 'avatars'])

/**
 * Per-bucket upload permissions.
 *
 * 'avatars' is open to every verified account: a reader editing their own profile
 * picture needs it, and they cannot choose the path or overwrite anyone else's
 * file. 'article-images' stays restricted to the roles that can write articles.
 */
const BUCKET_ROLES = {
  'article-images': ARTICLE_MUTATION_ROLES,
  avatars: ALL_ROLES,
} as const satisfies Record<string, readonly Role[]>

/**
 * Per-bucket size caps. An avatar is displayed at 128px at most, so the 10 MB
 * article allowance is far more room than it needs — and this bucket is writable
 * by every account, which makes it the one worth keeping tight.
 */
const BUCKET_MAX_BYTES: Record<string, number> = {
  'article-images': 4 * 1024 * 1024,
  avatars: MAX_AVATAR_BYTES,
}

export async function POST(request: NextRequest) {
  // Authenticate against the widest set here; the per-bucket check below narrows
  // it once we know which bucket the caller asked for.
  const auth = await requireVerifiedSessionUser(ALL_ROLES)
  if (!auth.ok) return auth.response

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl) {
    return NextResponse.json(
      { error: 'Image storage is temporarily unavailable. Please try again later.' },
      { status: 503 }
    )
  }

  if (!supabaseKey) {
    return NextResponse.json(
      { error: 'Image storage is temporarily unavailable. Please try again later.' },
      { status: 503 }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const bucketParam = (formData.get('bucket') as string | null) ?? 'article-images'

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
    }

    // Validate bucket against the allowlist
    if (!ALLOWED_BUCKETS.has(bucketParam)) {
      return NextResponse.json(
        { error: `Invalid bucket. Allowed values: ${[...ALLOWED_BUCKETS].join(', ')}.` },
        { status: 400 }
      )
    }

    // Then check this caller may write to THAT bucket. Doing it after the bucket
    // is known is what lets a reader upload an avatar without also gaining the
    // ability to upload article images.
    const allowedRoles = BUCKET_ROLES[bucketParam as keyof typeof BUCKET_ROLES]
    if (!allowedRoles.some((role) => role === auth.user.role)) {
      return NextResponse.json(
        { error: 'You do not have permission to upload to this bucket.' },
        { status: 403 }
      )
    }

    const maxBytes = BUCKET_MAX_BYTES[bucketParam] ?? 10 * 1024 * 1024
    if (!file.size || file.size > maxBytes) {
      return NextResponse.json(
        { error: `File too large (max ${Math.round(maxBytes / (1024 * 1024))} MB).` },
        { status: 400 }
      )
    }

    // Read the file into a buffer so we can inspect its magic bytes
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    // Verify actual file content rather than trusting the browser MIME type
    const detectedType = detectImageMimeType(bytes)
    if (!detectedType) {
      return NextResponse.json(
        {
          error: 'File type not permitted. Allowed formats: JPEG, PNG, GIF, WebP, AVIF.',
        },
        { status: 400 }
      )
    }

    if (file.type && file.type !== 'application/octet-stream' && file.type !== detectedType) {
      return NextResponse.json(
        { error: 'The image content does not match its file type.' },
        { status: 400 }
      )
    }
    let width: number | undefined
    let height: number | undefined
    if (bucketParam === 'article-images') {
      try {
        const image = sharp(Buffer.from(buffer), { limitInputPixels: 40_000_000, failOn: 'error' })
        const metadata = await image.metadata()
        await image.resize(1, 1).toBuffer() // Decode actual pixels, not just a forged header.
        width = metadata.width
        height = metadata.height
        if (!width || !height) throw new Error('No image dimensions')
      } catch {
        return NextResponse.json(
          { error: 'This image is damaged, invalid or too large to process.' },
          { status: 400 }
        )
      }
    }
    // Use the server-verified MIME type, not file.type
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    // Avatars are namespaced by uploader. Every account can write to this bucket,
    // so a flat namespace would let one person's filename collide with another's
    // (the upload then fails on `upsert: false`) and leaves no way to tell whose
    // file is whose.
    const filename =
      bucketParam === 'avatars'
        ? `${auth.user.id}/${Date.now()}-${safeName}`
        : `${auth.user.id}/${randomUUID()}.${({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' } as Record<string, string>)[detectedType]}`

    const managedUrl = supabase.storage.from(bucketParam).getPublicUrl(filename).data.publicUrl
    if (bucketParam === 'article-images') {
      // Reserve before the storage write: any interrupted request is tracked for GC.
      await prisma.articleImageAsset.create({
        data: { url: managedUrl, path: filename, uploaderId: auth.user.id },
      })
    }
    const { error: uploadError } = await supabase.storage
      .from(bucketParam)
      .upload(filename, buffer, { contentType: detectedType, upsert: false })

    if (uploadError) {
      console.error('[upload] Supabase error:', uploadError)
      return NextResponse.json(
        { error: 'The image could not be uploaded. Please try again.' },
        { status: 500 }
      )
    }

    const { data: urlData } = supabase.storage.from(bucketParam).getPublicUrl(filename)

    if (request.signal.aborted && bucketParam === 'article-images') {
      await supabase.storage.from(bucketParam).remove([filename])
      return NextResponse.json({ error: 'Upload cancelled.' }, { status: 499 })
    }
    return NextResponse.json(
      { url: urlData.publicUrl, ...(width && height ? { width, height } : {}) },
      { status: 201 }
    )
  } catch (err) {
    console.error('[upload] Unexpected error:', err)
    return NextResponse.json(
      { error: 'The image could not be uploaded. Please try again.' },
      { status: 500 }
    )
  }
}

/** Only the uploader can discard a managed upload; stored/shared objects are retained. */
export async function DELETE(request: NextRequest) {
  const auth = await requireVerifiedSessionUser(ARTICLE_MUTATION_ROLES)
  if (!auth.ok) return auth.response
  try {
    const body = await request.json()
    if (typeof body.url !== 'string' || body.url.length > 2000)
      return NextResponse.json({ error: 'Invalid image.' }, { status: 400 })
    if (!articleImagePath(body.url, auth.user.id))
      return NextResponse.json({ error: 'This image cannot be removed.' }, { status: 403 })
    await queueArticleImageCleanup(body.url, auth.user.id)
    return NextResponse.json({ result: 'queued' })
  } catch {
    return NextResponse.json({ error: 'Invalid image request.' }, { status: 400 })
  }
}
