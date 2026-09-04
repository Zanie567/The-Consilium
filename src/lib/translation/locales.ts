/**
 * The single allowlist of languages this site will translate into.
 *
 * This list is the cost boundary as much as the product surface: a locale that
 * is not in it is never sent to the provider, so the total number of paid
 * translations the site can ever generate is bounded by
 * (published articles x TARGET_LOCALES.length), no matter what a caller puts in
 * the ?lang= query string. Adding a language is a deliberate one-entry change
 * here; nothing else in the system enumerates languages.
 *
 * `deeplTarget` values are the literal target_lang codes from DeepL's supported
 * languages reference, not guesses:
 * https://developers.deepl.com/docs/getting-started/supported-languages
 * They are additionally verified against the provider's own /v2/languages
 * endpoint by scripts/verify-deepl.mjs before launch.
 */

/** The canonical language every article is written and stored in. */
export const SOURCE_LOCALE = 'en'

export interface TargetLocale {
  /** BCP 47 code used in URLs, the `lang` attribute and the database. */
  code: string
  /** Language name in its own language, as shown in the selector. */
  nativeName: string
  /** Language name in English, for aria-labels and server-side notices. */
  englishName: string
  /** Literal DeepL `target_lang` value. */
  deeplTarget: string
}

export const TARGET_LOCALES: readonly TargetLocale[] = [
  { code: 'fr', nativeName: 'Français', englishName: 'French',  deeplTarget: 'FR' },
  { code: 'es', nativeName: 'Español',  englishName: 'Spanish', deeplTarget: 'ES' },
  { code: 'de', nativeName: 'Deutsch',  englishName: 'German',  deeplTarget: 'DE' },
  // Simplified Chinese. DeepL accepts the unspecified `ZH` and the explicit
  // script variants `ZH-HANS` / `ZH-HANT`; `ZH-HANS` is used so the script is
  // never left to the provider's discretion.
  { code: 'zh', nativeName: '简体中文',   englishName: 'Simplified Chinese', deeplTarget: 'ZH-HANS' },
] as const

/** The source language, in the shape the selector renders. */
export const SOURCE_LANGUAGE = {
  code: SOURCE_LOCALE,
  nativeName: 'English',
  englishName: 'English',
} as const

/**
 * Resolves a user-supplied value to a supported target locale.
 *
 * Returns null for English, an unknown code, an array (?lang=fr&lang=es), or
 * anything else. Callers treat null as "render the canonical English article",
 * which is why an unsupported language degrades to the original rather than
 * erroring: there is no failure mode in which a bad ?lang value reaches the
 * provider.
 */
export function resolveTargetLocale(value: unknown): TargetLocale | null {
  if (typeof value !== 'string') return null
  const normalised = value.trim().toLowerCase()
  return TARGET_LOCALES.find((l) => l.code === normalised) ?? null
}

/** True when `value` names a supported target locale. */
export function isTargetLocale(value: unknown): boolean {
  return resolveTargetLocale(value) !== null
}
