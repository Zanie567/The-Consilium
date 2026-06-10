import { GLOSSARY_LIMITS } from '@/lib/constants'

/**
 * Server-side validation for glossary term payloads, shared by the create and
 * update routes. Returns either { data } with normalised values or { error }
 * with a message safe to show in the admin UI.
 */

export interface GlossaryTermFields {
  term: string
  aliases: string[]
  definition: string
  learnMoreUrl: string | null
  isActive: boolean
}

type ParseResult = { data: GlossaryTermFields } | { error: string }

export function parseGlossaryTermFields(input: unknown): ParseResult {
  if (typeof input !== 'object' || input === null) {
    return { error: 'Invalid request body.' }
  }
  const body = input as Record<string, unknown>

  if (typeof body.term !== 'string') {
    return { error: 'Term is required.' }
  }
  const term = body.term.trim().replace(/\s+/g, ' ')
  if (term.length < 2) {
    return { error: 'Term must be at least 2 characters.' }
  }
  if (term.length > GLOSSARY_LIMITS.TERM_MAX) {
    return { error: `Term must be ${GLOSSARY_LIMITS.TERM_MAX} characters or fewer.` }
  }

  let aliases: string[] = []
  if (body.aliases !== undefined && body.aliases !== null) {
    if (!Array.isArray(body.aliases) || body.aliases.some((a) => typeof a !== 'string')) {
      return { error: 'Aliases must be a list of strings.' }
    }
    const cleaned = (body.aliases as string[])
      .map((a) => a.trim().replace(/\s+/g, ' '))
      .filter((a) => a.length > 0)
    // De-duplicate case-insensitively and drop aliases equal to the term.
    const seen = new Set<string>([term.toLowerCase()])
    aliases = cleaned.filter((a) => {
      const lower = a.toLowerCase()
      if (seen.has(lower)) return false
      seen.add(lower)
      return true
    })
    if (aliases.length > GLOSSARY_LIMITS.ALIASES_MAX_COUNT) {
      return { error: `A term can have at most ${GLOSSARY_LIMITS.ALIASES_MAX_COUNT} aliases.` }
    }
    const tooLong = aliases.find((a) => a.length > GLOSSARY_LIMITS.ALIAS_MAX)
    if (tooLong) {
      return { error: `Aliases must be ${GLOSSARY_LIMITS.ALIAS_MAX} characters or fewer.` }
    }
  }

  if (typeof body.definition !== 'string') {
    return { error: 'Definition is required.' }
  }
  const definition = body.definition.trim()
  if (definition.length < GLOSSARY_LIMITS.DEFINITION_MIN) {
    return { error: `Definition must be at least ${GLOSSARY_LIMITS.DEFINITION_MIN} characters.` }
  }
  if (definition.length > GLOSSARY_LIMITS.DEFINITION_MAX) {
    return {
      error: `Definition must be ${GLOSSARY_LIMITS.DEFINITION_MAX} characters or fewer. Keep it to a few sentences; there is a learn more link for depth.`,
    }
  }

  let learnMoreUrl: string | null = null
  if (body.learnMoreUrl !== undefined && body.learnMoreUrl !== null) {
    if (typeof body.learnMoreUrl !== 'string') {
      return { error: 'Learn more URL must be a string.' }
    }
    const raw = body.learnMoreUrl.trim()
    if (raw.length > 0) {
      if (raw.length > GLOSSARY_LIMITS.URL_MAX) {
        return { error: `Learn more URL must be ${GLOSSARY_LIMITS.URL_MAX} characters or fewer.` }
      }
      let parsed: URL
      try {
        parsed = new URL(raw)
      } catch {
        return { error: 'Learn more URL must be a full http(s) URL.' }
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { error: 'Learn more URL must use http or https.' }
      }
      learnMoreUrl = raw
    }
  }

  const isActive = body.isActive === undefined ? true : body.isActive === true

  return { data: { term, aliases, definition, learnMoreUrl, isActive } }
}
