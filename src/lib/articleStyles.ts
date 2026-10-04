/** The editor/publication style contract. Only presentation values are accepted;
 * arbitrary CSS, URLs, declarations and markup never enter rendered attributes. */
export const SAFE_COLOUR = /^(?:#[\da-f]{3}(?:[\da-f]{3})?|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/i
export const SAFE_FONT_SIZE = /^(?:[89]|[1-6]\d|7[0-2])px$/
export const SAFE_LINE_HEIGHT = /^(?:1|1\.15|1\.5|2)$/
export const SAFE_ALIGNMENT = /^(?:left|center|right|justify)$/
export const SAFE_FONT_FAMILY = /^(?:Arial|Georgia|Helvetica|Times New Roman|Verdana|Courier New|sans-serif|serif|monospace)$/i

export function articleStyle(attrs: Record<string, unknown> | undefined, highlight = false): string {
  if (!attrs) return ''
  const values: [string, unknown, RegExp][] = highlight
    ? [['background-color', attrs.color, SAFE_COLOUR]]
    : [['color', attrs.color, SAFE_COLOUR], ['font-size', attrs.fontSize, SAFE_FONT_SIZE],
      ['font-family', attrs.fontFamily, SAFE_FONT_FAMILY], ['line-height', attrs.lineHeight, SAFE_LINE_HEIGHT],
      ['text-align', attrs.textAlign, SAFE_ALIGNMENT]]
  const style = values.filter(([,v,re]) => typeof v === 'string' && re.test(v)).map(([name,v]) => `${name}:${v}`).join(';')
  return style ? ` style="${style}"` : ''
}
