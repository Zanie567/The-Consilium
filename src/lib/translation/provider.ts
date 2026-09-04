import type { TargetLocale } from './locales'

/**
 * The contract every translation backend satisfies. Keeping the service behind
 * this interface is what lets the DeepL client be swapped, or stubbed in tests,
 * without the caching, invalidation or rendering layers knowing which provider
 * is in use.
 */
export interface TranslationProvider {
  /** Provider identifier recorded on each stored translation. */
  readonly name: string
  /**
   * Translates `texts` from English into `locale`, returning one output string
   * per input string, in the same order. Implementations must throw
   * TranslationProviderError rather than returning a partial array.
   */
  translate(texts: readonly string[], locale: TargetLocale): Promise<string[]>
}

export type TranslationFailureKind =
  | 'not_configured'
  | 'auth'
  | 'quota'
  | 'rate_limited'
  | 'unsupported_language'
  | 'malformed_response'
  | 'network'
  | 'provider_error'

export class TranslationProviderError extends Error {
  readonly kind: TranslationFailureKind
  readonly status?: number

  constructor(kind: TranslationFailureKind, message: string, status?: number) {
    super(message)
    this.name = 'TranslationProviderError'
    this.kind = kind
    this.status = status
  }
}
