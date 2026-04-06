import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return Response.json({ error: 'No file provided.' }, { status: 400 })
    }

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      return Response.json({ error: 'File must be a PDF.' }, { status: 400 })
    }

    if (file.size > 20 * 1024 * 1024) {
      return Response.json({ error: 'PDF too large (max 20 MB).' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // Dynamic import to avoid SSR issues with pdf-parse
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParseModule = await import('pdf-parse') as any
    const pdfParse = pdfParseModule.default ?? pdfParseModule
    const result = await pdfParse(buffer)

    const text = result.text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    if (!text) {
      return Response.json({ error: 'No text found in this PDF. It may be a scanned image.' }, { status: 422 })
    }

    return Response.json({ text, pages: result.numpages })
  } catch (err) {
    console.error('[parse-pdf] error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to parse PDF.' },
      { status: 500 }
    )
  }
}
