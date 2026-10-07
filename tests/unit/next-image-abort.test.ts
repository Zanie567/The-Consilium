import { expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { fetchInternalImage } from 'next/dist/server/image-optimizer'
import { serveStatic } from 'next/dist/server/serve-static'

it('a disconnected image requester cannot strand the shared local-file response', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'consilium-image-abort-'))
  const expected = Buffer.alloc(1024 * 1024, 1)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await fs.writeFile(path.join(directory, 'photo.png'), expected)
    const socket = Object.assign(new EventEmitter(), { writable: false, destroyed: true }) as unknown as Socket
    const request = { method: 'GET', socket } as IncomingMessage
    const result = await Promise.race([
      fetchInternalImage('/photo.png', request, {} as ServerResponse, (req, res) => serveStatic(req, res, 'photo.png', { root: directory })),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Disconnected requester stranded the shared image response')), 1500) }),
    ])
    expect(result.buffer.length).toBe(expected.length)
    expect(result.buffer.equals(expected)).toBe(true)
    expect(result.contentType).toBe('image/png')
  } finally {
    clearTimeout(timer)
    await fs.rm(directory, { recursive: true, force: true })
  }
})
