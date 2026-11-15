/**
 * Google Forms helpers shared by every page that embeds a form (the Trading Challenge registration,
 * the Pot Noodle Index submissions).
 *
 * Embed URL for a Google Forms responder link. Only docs.google.com form links are accepted, so a
 * mis-pasted URL can never put an arbitrary site in the page's iframe (the CSP's frame-src would block
 * it anyway; this keeps the UI honest about it too). A short forms.gle link cannot be embedded: the
 * page then offers the direct link only.
 */
export function googleFormEmbedUrl(responderUrl: string | null): string | null {
  if (!responderUrl) return null
  let url: URL
  try {
    url = new URL(responderUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !/^\/forms\/d\/e\/[\w-]+\/viewform$/.test(url.pathname)) {
    return null
  }
  return `https://docs.google.com${url.pathname}?embedded=true`
}

/** A link people can open directly: a docs.google.com form or a forms.gle short link, https only. */
export function isGoogleFormLink(value: string | null): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password &&
      ((url.hostname === 'docs.google.com' && url.pathname.startsWith('/forms/')) || url.hostname === 'forms.gle')
  } catch {
    return false
  }
}
