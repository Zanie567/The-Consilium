import { Mark, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentMark: {
      setCommentMark: (commentId: string) => ReturnType
      unsetCommentMark: (commentId: string) => ReturnType
    }
  }
}

export const CommentMark = Mark.create({
  name: 'commentMark',

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs) => {
          if (!attrs.commentId) return {}
          return { 'data-comment-id': attrs.commentId as string }
        },
      },
      resolved: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-resolved') === 'true',
        renderHTML: (attrs) => ({ 'data-resolved': String(attrs.resolved) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'mark[data-comment-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'mark',
      mergeAttributes(HTMLAttributes, {
        class: `comment-highlight${HTMLAttributes['data-resolved'] === 'true' ? ' comment-resolved' : ''}`,
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setCommentMark:
        (commentId: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { commentId, resolved: false }),

      unsetCommentMark:
        (commentId: string) =>
        ({ tr, state, dispatch }) => {
          let found = false
          state.doc.descendants((node, pos) => {
            if (!node.isInline) return
            const mark = node.marks.find(
              (m) => m.type.name === this.name && m.attrs.commentId === commentId
            )
            if (mark) {
              found = true
              if (dispatch) {
                tr.removeMark(pos, pos + node.nodeSize, mark.type)
              }
            }
          })
          if (found && dispatch) dispatch(tr)
          return found
        },
    }
  },
})
