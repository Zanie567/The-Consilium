import { NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cronAuth'
import { collectUnusedArticleImages } from '@/lib/articleImageStorage'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function GET(req: Request) {
  const error = verifyCronAuth(req, 'cleanup-article-images')
  if (error) return error
  try {
    return NextResponse.json({ removed: await collectUnusedArticleImages() })
  } catch {
    return NextResponse.json({ error: 'Image cleanup temporarily unavailable' }, { status: 503 })
  }
}
export const POST = GET
