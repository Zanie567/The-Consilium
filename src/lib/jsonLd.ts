/**
 * Serialise an object as a JSON-LD `<script>` body that is safe to embed via
 * `dangerouslySetInnerHTML`.
 *
 * `JSON.stringify` escapes `"` and `\\` but NOT `<`, `>` or `/`, so a value such
 * as an article title or author name containing the literal sequence
 * `</script>` would terminate the surrounding `<script type="application/ld+json">`
 * element and let the trailing markup execute - a stored XSS that runs for every
 * reader. Escaping `<`, `>` and `&` to their `\\u00xx` JSON forms (which remain
 * valid JSON and parse back identically) closes the breakout. The U+2028/U+2029
 * line separators are also escaped because they are valid in JSON but illegal in
 * a raw JavaScript/JSON `<script>` body.
 */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
