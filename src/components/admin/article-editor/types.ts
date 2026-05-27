import type React from 'react'
import type { KeyboardEvent } from 'react'
import type { TiptapEditorHandle } from '@/components/editor/TiptapEditor'

export interface Category {
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
    scheduledAt?: string | null
    editorNote?: string | null
    tags?: string[]
    authorId?: string
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

export interface ArticleEditorRefs {
  coverFileRef: React.RefObject<HTMLInputElement | null>
  editorRef: React.RefObject<TiptapEditorHandle | null>
  excerptDomRef: React.RefObject<HTMLTextAreaElement | null>
  titleDomRef: React.RefObject<HTMLTextAreaElement | null>
  toolbarPortalRef: React.RefObject<HTMLDivElement | null>
}

export interface ArticleEditorController {
  articleId?: string
  categories: Category[]
  canEdit: boolean
  canPublish: boolean
  categoryId: string
  content: string
  coverError: string
  coverImage: string
  currentStatus: string
  error: string
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
    addTag: (raw: string) => void
    handleBack: () => Promise<void>
    handleContentChange: (content: string) => void
    handleCoverUpload: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>
    handleSave: (overrideStatus?: string) => Promise<void>
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
