import { EB_Garamond } from 'next/font/google'

/**
 * The editor's document face. Loaded only where the Tiptap editor renders (the
 * editorial portal) rather than in the root layout, where it used to add two
 * preloaded font files to every public page that never used them. Apply
 * `editorFont.variable` to an ancestor of `.tiptap-editor`.
 */
export const editorFont = EB_Garamond({
  subsets: ['latin'],
  variable: '--font-eb-garamond',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
})
