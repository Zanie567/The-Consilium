import { describe, expect, it } from 'vitest'
import {
  articleWhereForEditorScope,
  createEditorCategoryScope,
  editorCanAccessCategory,
} from '@/lib/articleCategoryScope'

describe('editor category scope', () => {
  it('treats zero assignments as global editor access', () => {
    const scope = createEditorCategoryScope([])

    expect(scope.restricted).toBe(false)
    expect(editorCanAccessCategory(scope, 'analysis')).toBe(true)
    expect(editorCanAccessCategory(scope, null)).toBe(true)
    expect(articleWhereForEditorScope(scope)).toEqual({})
  })

  it('restricts assigned editors to exactly their assigned categories', () => {
    const scope = createEditorCategoryScope(['analysis', 'analysis', 'policy'])

    expect(scope).toEqual({ restricted: true, categoryIds: ['analysis', 'policy'] })
    expect(editorCanAccessCategory(scope, 'analysis')).toBe(true)
    expect(editorCanAccessCategory(scope, 'markets')).toBe(false)
    expect(editorCanAccessCategory(scope, null)).toBe(false)
    expect(articleWhereForEditorScope(scope)).toEqual({
      categoryId: { in: ['analysis', 'policy'] },
    })
  })
})
