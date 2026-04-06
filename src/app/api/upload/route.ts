import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  // Prefer service role key (bypasses RLS). Fall back to anon key if configured.
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
          'Find it in Supabase Dashboard → Project Settings → API → service_role.',
      },
      { status: 503 }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const bucket = (formData.get('bucket') as string | null) ?? 'article-images'

    if (!file) {
      return Response.json({ error: 'No file provided.' }, { status: 400 })
    }

    // Accept any image format
    if (!file.type.startsWith('image/')) {
      return Response.json(
        { error: `File must be an image. Received: ${file.type || 'unknown type'}.` },
        { status: 400 }
      )
    }

    if (file.size > 10 * 1024 * 1024) {
      return Response.json({ error: 'File too large (max 10 MB).' }, { status: 400 })
    }

    // Sanitise the original filename and prefix with timestamp to avoid collisions
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filename = `${Date.now()}-${safeName}`
    const buffer = await file.arrayBuffer()

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filename, buffer, { contentType: file.type, upsert: false })

    if (uploadError) {
      console.error('[upload] Supabase error:', uploadError)
      return Response.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500 }
      )
    }

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(filename)

    return Response.json({ url: urlData.publicUrl }, { status: 201 })
  } catch (err) {
    console.error('[upload] Unexpected error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Upload failed unexpectedly.' },
      { status: 500 }
    )
  }
}
