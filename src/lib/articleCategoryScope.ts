import type { Prisma } from '@prisma/client'

/**
 * Editors with no category assignments are global editors. Once at least one
 * assignment exists, the editor is restricted to exactly those categories.
 *
 * Keeping this meaning explicit avoids the previous `[]` ambiguity, where one
 * caller treated an empty list as "all categories" and another as "none".
 */
export type EditorCategoryScope =
  | { restricted: false; categoryIds: readonly [] }
  | { restricted: true; categoryIds: readonly string[] }

export function createEditorCategoryScope(categoryIds: readonly string[]): EditorCategoryScope {
  return categoryIds.length === 0
    ? { restricted: false, categoryIds: [] }
    : { restricted: true, categoryIds: [...new Set(categoryIds)] }
}

export function editorCanAccessCategory(
  scope: EditorCategoryScope,
  categoryId: string | null
): boolean {
  if (!scope.restricted) return true
  return categoryId !== null && scope.categoryIds.includes(categoryId)
}

export function articleWhereForEditorScope(
  scope: EditorCategoryScope
): Prisma.ArticleWhereInput {
  return scope.restricted ? { categoryId: { in: [...scope.categoryIds] } } : {}
}

export function categoryWhereForEditorScope(
  scope: EditorCategoryScope
): Prisma.CategoryWhereInput {
  return scope.restricted ? { id: { in: [...scope.categoryIds] } } : {}
}
