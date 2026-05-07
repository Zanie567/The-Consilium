import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, requireActiveSession } from '@/lib/auth'
import path from 'path'
import { pathToFileURL } from 'url'

// DOMMatrix polyfill - pdfjs-dist uses it even during text extraction,
// but Node.js does not expose it as a global. This minimal implementation
// is enough for coordinate transforms during text extraction.
function ensureDOMMatrix() {
  if (typeof globalThis.DOMMatrix !== 'undefined') return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).DOMMatrix = class DOMMatrix {
    a: number; b: number; c: number; d: number; e: number; f: number
    m11: number; m12: number; m13: number; m14: number
    m21: number; m22: number; m23: number; m24: number
    m31: number; m32: number; m33: number; m34: number
    m41: number; m42: number; m43: number; m44: number
    is2D: boolean; isIdentity: boolean

    constructor(init?: string | number[]) {
      this.a = 1;  this.b = 0;  this.c = 0;  this.d = 1;  this.e = 0;  this.f = 0
      this.m11 = 1; this.m12 = 0; this.m13 = 0; this.m14 = 0
      this.m21 = 0; this.m22 = 1; this.m23 = 0; this.m24 = 0
      this.m31 = 0; this.m32 = 0; this.m33 = 1; this.m34 = 0
      this.m41 = 0; this.m42 = 0; this.m43 = 0; this.m44 = 1
      this.is2D = true; this.isIdentity = true

      if (Array.isArray(init)) {
        if (init.length === 6) {
          this.a = this.m11 = init[0]
          this.b = this.m12 = init[1]
          this.c = this.m21 = init[2]
          this.d = this.m22 = init[3]
          this.e = this.m41 = init[4]
          this.f = this.m42 = init[5]
        } else if (init.length === 16) {
          this.m11 = init[0];  this.m12 = init[1];  this.m13 = init[2];  this.m14 = init[3]
          this.m21 = init[4];  this.m22 = init[5];  this.m23 = init[6];  this.m24 = init[7]
          this.m31 = init[8];  this.m32 = init[9];  this.m33 = init[10]; this.m34 = init[11]
          this.m41 = init[12]; this.m42 = init[13]; this.m43 = init[14]; this.m44 = init[15]
          this.a = this.m11; this.b = this.m12
          this.c = this.m21; this.d = this.m22
          this.e = this.m41; this.f = this.m42
          this.is2D = (this.m13 === 0 && this.m14 === 0 && this.m23 === 0 && this.m24 === 0 &&
            this.m31 === 0 && this.m32 === 0 && this.m33 === 1 && this.m34 === 0 &&
            this.m43 === 0 && this.m44 === 1)
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    multiply(other: any) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const G = globalThis as any
      const m = new G.DOMMatrix()
      m.a  = this.a * other.a  + this.c * other.b
      m.b  = this.b * other.a  + this.d * other.b
      m.c  = this.a * other.c  + this.c * other.d
      m.d  = this.b * other.c  + this.d * other.d
      m.e  = this.a * other.e  + this.c * other.f  + this.e
      m.f  = this.b * other.e  + this.d * other.f  + this.f
      m.m11 = m.a; m.m12 = m.b; m.m21 = m.c; m.m22 = m.d; m.m41 = m.e; m.m42 = m.f
      return m
    }

    translate(tx = 0, ty = 0, _tz = 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const G = globalThis as any
      const m = new G.DOMMatrix([this.a, this.b, this.c, this.d, this.e + this.a * tx + this.c * ty, this.f + this.b * tx + this.d * ty])
      return m
    }

    scale(sx = 1, sy = sx, _sz = 1, _ox = 0, _oy = 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const G = globalThis as any
      return new G.DOMMatrix([this.a * sx, this.b * sx, this.c * sy, this.d * sy, this.e, this.f])
    }

    rotate(_angle = 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new (globalThis as any).DOMMatrix()
    }

    inverse() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const G = globalThis as any
      const det = this.a * this.d - this.b * this.c
      if (Math.abs(det) < 1e-10) return new G.DOMMatrix()
      return new G.DOMMatrix([
        this.d / det, -this.b / det,
        -this.c / det, this.a / det,
        (this.c * this.f - this.d * this.e) / det,
        (this.b * this.e - this.a * this.f) / det,
      ])
    }

    transformPoint(pt: { x?: number; y?: number } = {}) {
      const x = pt.x ?? 0, y = pt.y ?? 0
      return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static fromMatrix(init: any) { return new (globalThis as any).DOMMatrix(init) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static fromFloat32Array(a: Float32Array) { return new (globalThis as any).DOMMatrix(Array.from(a) as number[]) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static fromFloat64Array(a: Float64Array) { return new (globalThis as any).DOMMatrix(Array.from(a) as number[]) }
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  const authError = requireActiveSession(session)
  if (authError) return authError

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

    // Polyfill DOMMatrix before loading pdfjs (it needs it even for text extraction)
    ensureDOMMatrix()

    const buffer = Buffer.from(await file.arrayBuffer())
    const data = new Uint8Array(buffer)

    // Use pdfjs-dist directly - more reliable in Node.js than the pdf-parse wrapper
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs') as any

    // In pdfjs-dist v5, Node.js always uses the "fake worker" path (no Web Worker API).
    // The fake worker is loaded via dynamic import() of workerSrc - it must be a non-empty,
    // resolvable path. Use a file:// URL pointing to the bundled worker file.
    const workerPath = path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
    pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href

    let loadingTask: any // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      loadingTask = pdfjsLib.getDocument({
        data,
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: true,
        disableFontFace: true,
        verbosity: 0, // suppress console warnings
      })
      // Reject immediately on password-protected PDFs rather than hanging
      loadingTask.onPassword = () => {
        loadingTask.destroy?.()
        throw new Error('__password__')
      }
    } catch (e) {
      if (e instanceof Error && e.message === '__password__') {
        return Response.json({ error: 'This PDF is password-protected and cannot be imported.' }, { status: 422 })
      }
      throw e
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pdf: any
    try {
      pdf = await loadingTask.promise
    } catch (e) {
      // pdfjs throws PasswordException for encrypted PDFs
      if (e && typeof e === 'object' && (e as any).name === 'PasswordException') {
        return Response.json({ error: 'This PDF is password-protected and cannot be imported.' }, { status: 422 })
      }
      if (e && typeof e === 'object' && (e as any).name === 'InvalidPDFException') {
        return Response.json({ error: 'The file does not appear to be a valid PDF.' }, { status: 422 })
      }
      throw e
    }
    const numPages: number = pdf.numPages

    if (numPages === 0) {
      return Response.json({ error: 'This PDF has no pages.' }, { status: 422 })
    }

    const pageTexts: string[] = []
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum)
      const content = await page.getTextContent()

      // Reconstruct readable text, preserving line breaks
      let lastY: number | null = null
      let pageText = ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const item of content.items as any[]) {
        if (!('str' in item)) continue
        const y = item.transform?.[5] ?? 0
        if (lastY !== null && Math.abs(y - lastY) > 5) {
          pageText += '\n'
        }
        pageText += item.str
        if (item.hasEOL) pageText += '\n'
        lastY = y
      }
      pageTexts.push(pageText.trim())
    }

    const text = pageTexts
      .join('\n\n')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    if (!text) {
      return Response.json({ error: 'No text found in this PDF. It may be a scanned image.' }, { status: 422 })
    }

    return Response.json({ text, pages: numPages })
  } catch (err) {
    console.error('[parse-pdf] error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to parse PDF.' },
      { status: 500 }
    )
  }
}
