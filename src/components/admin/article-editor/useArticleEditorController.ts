'use client'

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import slugify from 'slugify'
import { mutate as globalMutate } from 'swr'
import type { TiptapEditorHandle } from '@/components/editor/TiptapEditor'
import { DRAFTS_SWR_KEY } from '@/components/editorial/DraftsSection'
import type { ArticleEditorController, ArticleEditorProps, SaveStatus, UserOption } from './types'

export function useArticleEditorController({
  articleId,
  initialData,
  categories,
  authorId,
  canPublish,
  returnUrl,
  isWriter,
}: ArticleEditorProps): ArticleEditorController {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const [themeMounted, setThemeMounted] = useState(false)

  const [title, setTitle] = useState(initialData?.title ?? '')
  const [slug, setSlugState] = useState(initialData?.slug ?? '')
  const [content, setContent] = useState(initialData?.content ?? '')
  const [excerpt, setExcerptState] = useState(initialData?.excerpt ?? '')
  const [coverImage, setCoverImageState] = useState(initialData?.coverImage ?? '')
  const [categoryId, setCategoryIdState] = useState(initialData?.categoryId ?? '')
  const [status, setStatusState] = useState(initialData?.status ?? 'DRAFT')
  const [scheduledAt, setScheduledAtState] = useState(initialData?.scheduledAt ?? '')
  const [tags, setTags] = useState<string[]>(initialData?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [selectedAuthorId, setSelectedAuthorIdState] = useState(initialData?.authorId ?? authorId)
  const [users, setUsers] = useState<UserOption[]>([])

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [savedVisible, setSavedVisible] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [coverError, setCoverError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)

  const articleIdRef = useRef<string | undefined>(articleId)
  const isCreatingRef = useRef(false)
  const isDirtyRef = useRef(false)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const savedFadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const titleRef = useRef(title)
  const slugRef = useRef(slug)
  const contentRef = useRef(content)
  const excerptRef = useRef(excerpt)
  const coverImageRef = useRef(coverImage)
  const categoryIdRef = useRef(categoryId)
  const statusRef = useRef(status)
  const scheduledAtRef = useRef(scheduledAt)
  const tagsRef = useRef(tags)
  const selectedAuthorIdRef = useRef(selectedAuthorId)

  const titleDomRef = useRef<HTMLTextAreaElement>(null)
  const excerptDomRef = useRef<HTMLTextAreaElement>(null)
  const coverFileRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<TiptapEditorHandle | null>(null)
  const toolbarPortalRef = useRef<HTMLDivElement>(null)

  const currentStatus = initialData?.status ?? 'DRAFT'
  const canEdit = !isWriter || currentStatus === 'DRAFT' || currentStatus === 'REJECTED'

  useEffect(() => setThemeMounted(true), [])

  useEffect(() => {
    if (isWriter) return
    fetch('/api/editorial/users')
      .then((response) => (response.ok ? response.json() : []))
      .then((data: UserOption[]) => {
        if (Array.isArray(data)) setUsers(data)
      })
      .catch(() => {})
  }, [isWriter])

  useEffect(() => { titleRef.current = title }, [title])
  useEffect(() => { slugRef.current = slug }, [slug])
  useEffect(() => { contentRef.current = content }, [content])
  useEffect(() => { excerptRef.current = excerpt }, [excerpt])
  useEffect(() => { coverImageRef.current = coverImage }, [coverImage])
  useEffect(() => { categoryIdRef.current = categoryId }, [categoryId])
  useEffect(() => { statusRef.current = status }, [status])
  useEffect(() => { scheduledAtRef.current = scheduledAt }, [scheduledAt])
  useEffect(() => { tagsRef.current = tags }, [tags])
  useEffect(() => { selectedAuthorIdRef.current = selectedAuthorId }, [selectedAuthorId])

  useEffect(() => {
    const element = titleDomRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [title])

  useEffect(() => {
    const element = excerptDomRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [excerpt])

  const performSave = useCallback(async (overrideStatus?: string) => {
    const currentId = articleIdRef.current
    const finalStatus = overrideStatus ?? statusRef.current

    if (finalStatus === 'SCHEDULED' && !scheduledAtRef.current) {
      setError('Please pick a future date and time to schedule this article.')
      return false
    }

    setSaveStatus('saving')
    setSavedVisible(false)

    const body = {
      title: titleRef.current,
      slug: slugRef.current,
      content: contentRef.current,
      excerpt: excerptRef.current,
      coverImage: coverImageRef.current || null,
      categoryId: categoryIdRef.current || null,
      authorId: selectedAuthorIdRef.current,
      status: finalStatus,
      tags: tagsRef.current,
      ...(finalStatus === 'SCHEDULED' && scheduledAtRef.current
        ? { scheduledAt: scheduledAtRef.current }
        : {}),
    }

    try {
      let response: Response

      if (currentId) {
        response = await fetch(`/api/articles/${currentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        if (isCreatingRef.current) return false
        isCreatingRef.current = true
        response = await fetch('/api/articles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, status: 'DRAFT' }),
        })
      }

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error ?? 'Failed to save.')
        setSaveStatus('error')
        return false
      }

      const saved = await response.json()
      setSaveStatus('saved')
      setSavedVisible(true)
      isDirtyRef.current = false

      if (!currentId && saved.id) {
        articleIdRef.current = saved.id
        isCreatingRef.current = false
        router.replace(`/editorial/articles/${saved.id}/edit`)
      }

      if (overrideStatus) setStatusState(overrideStatus)
      globalMutate(DRAFTS_SWR_KEY)

      clearTimeout(savedFadeTimer.current)
      savedFadeTimer.current = setTimeout(() => setSavedVisible(false), 3000)
      clearTimeout(savedTimeoutRef.current)
      savedTimeoutRef.current = setTimeout(() => setSaveStatus('idle'), 4200)

      return true
    } catch {
      isCreatingRef.current = false
      setSaveStatus('error')
      return false
    }
  }, [router])

  const scheduleAutosave = useCallback(() => {
    if (!canEdit) return
    isDirtyRef.current = true
    clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      void performSave()
    }, 2000)
  }, [canEdit, performSave])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isDirtyRef.current && canEdit) {
        clearTimeout(autoSaveTimer.current)
        void performSave()
      }
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
      void performSave()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [canEdit, performSave])

  useEffect(() => () => {
    clearTimeout(autoSaveTimer.current)
    clearTimeout(savedFadeTimer.current)
    clearTimeout(savedTimeoutRef.current)
  }, [])

  const updateTitle = (value: string) => {
    setTitle(value)
    if (!articleIdRef.current) {
      const nextSlug = slugify(value, { lower: true, strict: true, trim: true })
      setSlugState(nextSlug)
      slugRef.current = nextSlug
    }
    scheduleAutosave()
  }

  const handleContentChange = useCallback((nextContent: string) => {
    setContent(nextContent)
    scheduleAutosave()
  }, [scheduleAutosave])

  const handleSave = async (overrideStatus?: string) => {
    if (overrideStatus && overrideStatus !== 'DRAFT' && !titleRef.current.trim()) {
      setError('A title is required before publishing or submitting.')
      return
    }
    clearTimeout(autoSaveTimer.current)
    setError('')
    isCreatingRef.current = false
    await performSave(overrideStatus)

    if (!articleIdRef.current) return
    if (overrideStatus && articleId) router.refresh()
  }

  const handleBack = async () => {
    if (isDirtyRef.current && canEdit) {
      clearTimeout(autoSaveTimer.current)
      await performSave()
    }
    router.push(returnUrl ?? '/editorial')
  }

  const addTag = (raw: string) => {
    const name = raw.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    if (name && !tags.includes(name) && tags.length < 10) {
      const next = [...tags, name]
      setTags(next)
      tagsRef.current = next
    }
    setTagInput('')
    scheduleAutosave()
  }

  const removeTag = (tag: string) => {
    const next = tags.filter((item) => item !== tag)
    setTags(next)
    tagsRef.current = next
    scheduleAutosave()
  }

  const handleTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addTag(tagInput)
      return
    }
    if (event.key === 'Backspace' && !tagInput && tags.length > 0) {
      const next = tags.slice(0, -1)
      setTags(next)
      tagsRef.current = next
      scheduleAutosave()
    }
  }

  const uploadCoverFile = async (file: File) => {
    setUploading(true)
    setCoverError('')
    const form = new FormData()
    form.append('file', file)
    form.append('bucket', 'article-images')
    try {
      const response = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await response.json()
      if (response.ok) {
        setCoverImageState(data.url)
        coverImageRef.current = data.url
        scheduleAutosave()
      } else {
        setCoverError(data.error ?? 'Upload failed.')
      }
    } catch {
      setCoverError('Upload failed. Check your connection.')
    } finally {
      setUploading(false)
    }
  }

  const handleCoverUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    await uploadCoverFile(file)
    event.target.value = ''
  }

  const setStatus = (value: string) => {
    setStatusState(value)
    statusRef.current = value
    scheduleAutosave()
  }

  const setScheduledAt = (value: string) => {
    setScheduledAtState(value)
    scheduledAtRef.current = value
    scheduleAutosave()
  }

  const setCategoryId = (value: string) => {
    setCategoryIdState(value)
    categoryIdRef.current = value
    scheduleAutosave()
  }

  const setCoverImage = (value: string) => {
    setCoverImageState(value)
    coverImageRef.current = value
    scheduleAutosave()
  }

  const setExcerpt = (value: string) => {
    setExcerptState(value)
    excerptRef.current = value
    scheduleAutosave()
  }

  const setSlug = (value: string) => {
    setSlugState(value)
    slugRef.current = value
    scheduleAutosave()
  }

  const setSelectedAuthorId = (value: string) => {
    setSelectedAuthorIdState(value)
    selectedAuthorIdRef.current = value
    scheduleAutosave()
  }

  const removeCoverImage = () => setCoverImage('')
  const openCoverPicker = () => coverFileRef.current?.click()

  return {
    articleId: articleIdRef.current,
    categories,
    canEdit,
    canPublish,
    categoryId,
    content,
    coverError,
    coverImage,
    currentStatus,
    error,
    excerpt,
    initialEditorNote: initialData?.editorNote,
    isDark: theme === 'dark',
    isWriter,
    saveStatus,
    savedVisible,
    scheduledAt,
    selectedAuthorId,
    settingsOpen,
    slug,
    status,
    tagInput,
    tags,
    themeMounted,
    title,
    tutorialOpen,
    uploading,
    users,
    refs: {
      coverFileRef,
      editorRef,
      excerptDomRef,
      titleDomRef,
      toolbarPortalRef,
    },
    actions: {
      addTag,
      handleBack,
      handleContentChange,
      handleCoverUpload,
      handleSave,
      handleTagKeyDown,
      openCoverPicker,
      removeCoverImage,
      removeTag,
      setCategoryId,
      setCoverImage,
      setExcerpt,
      setScheduledAt,
      setSelectedAuthorId,
      setSettingsOpen,
      setSlug,
      setStatus,
      setTagInput,
      setTheme,
      setTutorialOpen,
      updateTitle,
    },
  }
}
