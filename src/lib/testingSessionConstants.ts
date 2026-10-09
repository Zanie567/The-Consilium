/** Shared by the server capability resolver and the independent operator check. */
export const TESTING_COOKIE = 'consilium-testing'

// Client-safe: the persona allow-list and the role each persona must actually hold.
export const TEST_PERSONAS = ['writer', 'writer-other', 'editor', 'editor-global', 'growth'] as const
export type TestPersona = typeof TEST_PERSONAS[number]
export const PERSONA_ROLES = { writer: 'WRITER', 'writer-other': 'WRITER', editor: 'EDITOR', 'editor-global': 'EDITOR', growth: 'GROWTH' } as const
