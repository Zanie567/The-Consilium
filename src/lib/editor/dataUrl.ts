/**
 * Turns a `data:` URL (the form images take when pasted from Word or Google Docs) into a
 * File without calling fetch(). The site's Content-Security-Policy is
 * `connect-src 'self' https:`, which blocks fetch() of a data: URL, so the old
 * fetch(dataUrl) approach failed in the browser and every pasted image was dropped.
 */
export function dataUrlToFile(dataUrl: string, filename: string): File | null {
  const match = /^data:([^;,]+)((?:;[^;,]+)*?);base64,([A-Za-z0-9+/=\s]*)$/.exec(dataUrl)
  if (!match) return null
  let binary: string
  try {
    binary = atob(match[3].replace(/\s+/g, ''))
  } catch {
    return null
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], filename, { type: match[1] })
}
