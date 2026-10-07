import type React from 'react'
import type { KeyboardEvent } from 'react'
import type { TiptapEditorHandle } from '@/components/editor/TiptapEditor'
import type { ApiErrorKind } from '@/lib/apiClient'

interface Category {
  id: string
  name: string
  slug: string
}

export interface UserOption {
  id: string
  name: string | null
  role: string
}

export interface ArticleEditorProps {
  articleId?: string
  initialData?: {
    title: string
    slug: string
    content: string
    excerpt: string
    coverImage: string
    categoryId: string
    status: string
    updatedAt?: string
    scheduledAt?: string | null
    editorNote?: string | null
    tags?: string[]
    authorId?: string
    /** Fingerprint of the article as loaded; sent back with each save (see articleVersion.ts). */
    version?: string
  }
  categories: Category[]
  authorId: string
  canPublish: boolean
  returnUrl?: string
  isWriter?: boolean
}

export interface ArticleEditorHookProps extends ArticleEditorProps {
  refs: ArticleEditorRefs
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface ArticleEditorError {
  kind: ApiErrorKind | 'editor-validation'
  /** Short text for compact toolbar save indicators. */
  label: string
  /** Actionable explanation rendered in the editor banner. */
  message: string
  requestId?: string
  /** Server error code, e.g. ARTICLE_CONFLICT, so the banner can offer the right actions. */
  code?: string
}

export interface ArticleEditorRefs {
  coverFileRef: React.RefObject<HTMLInputElement | null>
  editorRef: React.RefObject<TiptapEditorHandle | null>
  excerptDomRef: React.RefObject<HTMLTextAreaElement | null>
  titleDomRef: React.RefObject<HTMLTextAreaElement | null>
  toolbarPortalRef: React.RefObject<HTMLDivElement | null>
}

/** The button that applies the staged status (see useArticleEditorController). */
export interface StatusAction {
  label: string
  /** The status the button asks the server for. */
  target: string
  tone: 'publish' | 'unpublish' | 'schedule' | 'set'
}

export interface ArticleEditorController {
  articleId?: string
  recovery: { at: number; stale: boolean } | null
  recovered: boolean
  recoveryError: string
  recoveryRevision: number
  statusAction: StatusAction | null
  /** Target status awaiting the user's confirmation, or null when no dialog is open. */
  pendingStatus: string | null
  scheduledAtForDialog: string
  categories: Category[]
  canEdit: boolean
  canPublish: boolean
  categoryId: string
  content: string
  coverError: string
  coverImage: string
  currentStatus: string
  error: ArticleEditorError | null
  excerpt: string
  initialEditorNote?: string | null
  isDark: boolean
  isWriter?: boolean
  saveStatus: SaveStatus
  savedVisible: boolean
  scheduledAt: string
  selectedAuthorId: string
  settingsOpen: boolean
  slug: string
  status: string
  tagInput: string
  tags: string[]
  themeMounted: boolean
  title: string
  tutorialOpen: boolean
  uploading: boolean
  users: UserOption[]
  actions: {
    /** Ask for a status change; opens a confirmation first when it alters public visibility. */
    restoreLocalDraft: () => void
    discardLocalDraft: () => void
    requestStatusChange: (target: string) => void
    confirmStatusChange: () => Promise<void>
    cancelStatusChange: () => void
    addTag: (raw: string) => void
    handleBack: () => Promise<void>
    handleContentChange: (content: string) => void
    handleCoverUpload: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>
    handleSave: (overrideStatus?: string) => Promise<void>
    /** After a conflict: save this tab's version over the newer one, on purpose. */
    keepMyVersion: () => void
    /** After a conflict: discard this tab's unsaved changes and load the newer version. */
    reloadLatest: () => void
    handleTagKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
    openCoverPicker: () => void
    removeCoverImage: () => void
    removeTag: (tag: string) => void
    setCategoryId: (value: string) => void
    setCoverImage: (value: string) => void
    setExcerpt: (value: string) => void
    setScheduledAt: (value: string) => void
    setSelectedAuthorId: (value: string) => void
    setSettingsOpen: (value: boolean | ((current: boolean) => boolean)) => void
    setSlug: (value: string) => void
    setStatus: (value: string) => void
    setTagInput: (value: string) => void
    setTheme: (value: string) => void
    setTutorialOpen: (value: boolean) => void
    updateTitle: (value: string) => void
  }
}
