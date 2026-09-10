import { prisma } from '@/lib/prisma'
import {
  createEditorCategoryScope,
  editorCanAccessCategory,
  type EditorCategoryScope,
} from '@/lib/articleCategoryScope'

interface CategoryAssignmentReader {
  categoryEditor: {
    findMany(args: {
      where: { userId: string }
      select: { categoryId: true }
    }): Promise<Array<{ categoryId: string }>>
  }
}

export async function loadEditorCategoryScope(
  userId: string,
  db: CategoryAssignmentReader = prisma
): Promise<EditorCategoryScope> {
  const assignments = await db.categoryEditor.findMany({
    where: { userId },
    select: { categoryId: true },
  })

  return createEditorCategoryScope(assignments.map((assignment) => assignment.categoryId))
}

export async function editorCanAccessArticleCategory(
  userId: string,
  categoryId: string | null,
  db: CategoryAssignmentReader = prisma
): Promise<boolean> {
  const scope = await loadEditorCategoryScope(userId, db)
  return editorCanAccessCategory(scope, categoryId)
}
