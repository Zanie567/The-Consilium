import { Table } from '@tiptap/extension-table'

/** Metadata on the established native table node, never a competing block. */
export const ArticleTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...Object.fromEntries(
        ['caption', 'source', 'sourceUrl', 'note'].map((name) => [
          name,
          {
            default: '',
            parseHTML: (element: HTMLElement) =>
              element.getAttribute(`data-${name.toLowerCase()}`) ?? '',
            renderHTML: (attrs: Record<string, string>) =>
              attrs[name] ? { [`data-${name.toLowerCase()}`]: attrs[name] } : {},
          },
        ])
      ),
    }
  },
})
