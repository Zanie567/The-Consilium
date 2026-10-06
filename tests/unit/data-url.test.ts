// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { dataUrlToFile } from '@/lib/editor/dataUrl'

describe('dataUrlToFile', () => {
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  it('decodes a base64 image into a File with its type, name and bytes', async () => {
    const file = dataUrlToFile(`data:image/png;base64,${PNG_B64}`, 'p.png')!
    expect(file.name).toBe('p.png')
    expect(file.type).toBe('image/png')
    const bytes = new Uint8Array(await file.arrayBuffer())
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('tolerates a charset parameter and whitespace in the payload', async () => {
    const spaced = PNG_B64.replace(/(.{20})/g, '$1\n')
    const file = dataUrlToFile(`data:image/png;charset=utf-8;base64,${spaced}`, 'p.png')
    expect(file?.size).toBeGreaterThan(10)
  })

  it('returns null for anything that is not a base64 data URL', () => {
    expect(dataUrlToFile('https://example.org/a.png', 'a.png')).toBeNull()
    expect(dataUrlToFile('data:text/plain,hello', 'a.txt')).toBeNull()
    expect(dataUrlToFile('data:image/png;base64,@@@not-base64@@@', 'a.png')).toBeNull()
  })
})
