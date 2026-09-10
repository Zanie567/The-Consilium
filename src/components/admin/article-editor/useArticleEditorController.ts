'use client'

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import slugify from 'slugify'
import { mutate as globalMutate } from 'swr'
import { DRAFTS_SWR_KEY } from '@/components/editorial/DraftsSection'
import { ApiError, apiRequest, asApiError } from '@/lib/apiClient'
import type {
  ArticleEditorController,
  ArticleEditorError,
  ArticleEditorHookProps,
  SaveStatus,
  UserOption,
} from './types'

interface SavedArticleResponse {
  id?: string
}

function localEditorError(message: string): ArticleEditorError {
  return { kind: 'editor-validation', label: 'Check article details', message }
}

function articleSaveError(reason: unknown): ArticleEditorError {
  const error = asApiError(reason)
  const base = { kind: error.kind, requestId: error.requestId }

  switch (error.kind) {
    case 'auth':
      return {
        ...base,
        label: 'Session expired',
        message: 'Your session has expired. Sign in again in a new tab, then retry saving. Your unsaved changes are still in this tab.',
      }
    case 'permission':
      if (error.code === 'CATEGORY_SCOPE_DENIED') {
        return {
          ...base,
          label: 'Category access denied',
          message: `${error.message} Ask an administrator to update your category assignment if you should be able to edit it.`,
        }
      }
      if (error.code === 'ACCOUNT_INACTIVE' || error.code === 'ACCOUNT_SUSPENDED') {
        return {
          ...base,
          label: error.code === 'ACCOUNT_SUSPENDED' ? 'Account suspended' : 'Account inactive',
          message: `${error.message} Contact an administrator before retrying.`,
        }
      }
      return {
        ...base,
        label: 'Permission denied',
        message: `${error.message} Ask an administrator for access if you believe this is incorrect.`,
      }
    case 'validation':
      return {
        ...base,
        label: 'Check article details',
        message: `The article could not be saved: ${error.message}`,
      }
    case 'conflict':
      return {
        ...base,
        label: 'Save conflict',
        message: `${error.message} Your unsaved changes remain in this tab.`,
      }
    case 'schema':
      return {
        ...base,
        label: 'Database schema mismatch',
        message: `${error.message} Your unsaved changes remain in this tab; contact an administrator before retrying.`,
      }
    case 'server':
      return {
        ...base,
        label: 'Server/database error',
        message: `${error.message} Your unsaved changes remain in this tab; try again shortly.`,
      }
    case 'timeout':
      return {
        ...base,
        label: 'Save timed out',
        message: 'Saving took longer than 15 seconds. Check your connection, then retry. Your unsaved changes remain in this tab.',
      }
    case 'network':
      return {
        ...base,
        label: 'Network error',
        message: 'The server could not be reached. Check your connection, then retry saving. Your unsaved changes remain in this tab.',
      }
    default:
      return {
        ...base,
        label: 'Save failed',
        message: `${error.message} Your unsaved changes remain in this tab.`,
      }
  }
}

export function useArticleEditorController({
  articleId,
  initialData,
  categories,
  authorId,
  canPublish,
  returnUrl,
  isWriter,
  refs: { coverFileRef, excerptDomRef, titleDomRef },
}: ArticleEditorHookProps): ArticleEditorController {
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
  const [error, setError] = useState<ArticleEditorError | null>(null)
  const [coverError, setCoverError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)

  const articleIdRef = useRef<string | undefined>(articleId)
  const isDirtyRef = useRef(false)
  const editVersionRef = useRef(0)
  const statusIntentVersionRef = useRef(0)
  const saveRequestRef = useRef(0)
  const latestSaveRequestRef = useRef(0)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
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
  }, [title, titleDomRef])

  useEffect(() => {
    const element = excerptDomRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [excerpt, excerptDomRef])

  const performSave = useCallback((overrideStatus?: string): Promise<boolean> => {
    const requestedStatus = overrideStatus ?? statusRef.current
    const requestNumber = ++saveRequestRef.current
    latestSaveRequestRef.current = requestNumber

    if (requestedStatus === 'SCHEDULED' && !scheduledAtRef.current) {
      setError(localEditorError('Please pick a future date and time to schedule this article.'))
      setSaveStatus('error')
      return Promise.resolve(false)
    }

    // A status button is an intent of its own. Remember its sequence so an
    // older publish/submit response cannot overwrite a newer status selection.
    const statusIntentVersion = overrideStatus
      ? ++statusIntentVersionRef.current
      : statusIntentVersionRef.current

    clearTimeout(savedFadeTimer.current)
    clearTimeout(savedTimeoutRef.current)
    setSaveStatus('saving')
    setSavedVisible(false)
    setError(null)

    const execute = async (): Promise<boolean> => {
      try {
        // Snapshot only when this queued save begins. This means a normal
        // autosave queued behind a status transition observes whether that
        // transition succeeded, instead of accidentally reverting it with the
        // status that was visible while the earlier request was in flight.
        const finalStatus = overrideStatus ?? statusRef.current
        if (finalStatus === 'SCHEDULED' && !scheduledAtRef.current) {
          throw new ApiError(
            'validation',
            'Please pick a future date and time to schedule this article.',
          )
        }
        const editVersion = editVersionRef.current
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

        // Resolve the id only when this queued task begins. If an earlier queued
        // POST created the draft, every later task becomes a PUT instead of
        // creating a duplicate article.
        const currentId = articleIdRef.current
        let saved: SavedArticleResponse
        if (currentId) {
          saved = await apiRequest<SavedArticleResponse>(`/api/articles/${currentId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
        } else {
          // Creation remains a draft first so a requested publish/submit uses
          // the normal PUT transition path (including review notifications and
          // publication cache invalidation). If that second mutation fails, the
          // created id is retained so retrying cannot create a duplicate.
          saved = await apiRequest<SavedArticleResponse>('/api/articles', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...body, status: 'DRAFT' }),
            })
          if (!saved?.id) {
            throw new ApiError(
              'server',
              'The server created no identifiable article. This may indicate a schema error.',
            )
          }
          articleIdRef.current = saved.id
          router.replace(`/editorial/articles/${saved.id}/edit`)

          if (finalStatus !== 'DRAFT') {
            saved = await apiRequest<SavedArticleResponse>(`/api/articles/${saved.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
          }
        }

        if (overrideStatus && statusIntentVersion === statusIntentVersionRef.current) {
          setStatusState(overrideStatus)
          statusRef.current = overrideStatus
        }

        // A response only acknowledges the exact snapshot it sent. Edits made
        // while this request was in flight stay dirty until their own queued save
        // succeeds.
        if (editVersion === editVersionRef.current) isDirtyRef.current = false

        void globalMutate(DRAFTS_SWR_KEY)

        // Older queued responses must not replace the status/error belonging to
        // a newer queued request.
        if (requestNumber === latestSaveRequestRef.current) {
          setError(null)
          if (editVersion === editVersionRef.current) {
            setSaveStatus('saved')
            setSavedVisible(true)
            savedFadeTimer.current = setTimeout(() => {
              if (requestNumber === latestSaveRequestRef.current && !isDirtyRef.current) {
                setSavedVisible(false)
              }
            }, 3000)
            savedTimeoutRef.current = setTimeout(() => {
              if (requestNumber === latestSaveRequestRef.current && !isDirtyRef.current) {
                setSaveStatus('idle')
              }
            }, 4200)
          } else {
            setSaveStatus('idle')
          }
        }

        return true
      } catch (reason) {
        if (requestNumber === latestSaveRequestRef.current) {
          setError(articleSaveError(reason))
          setSaveStatus('error')
          setSavedVisible(false)
        }
        return false
      }
    }

    // Serialize every mutation. There are deliberately no automatic retries:
    // POST and status transitions are not generally safe to replay without an
    // idempotency key.
    const result = saveQueueRef.current.then(execute, execute)
    saveQueueRef.current = result.then(() => undefined, () => undefined)
    return result
  }, [router])

  const scheduleAutosave = useCallback(() => {
    if (!canEdit) return
    editVersionRef.current += 1
    isDirtyRef.current = true
    clearTimeout(savedFadeTimer.current)
    clearTimeout(savedTimeoutRef.current)
    setSavedVisible(false)
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
      // Browsers do not wait for asynchronous fetches started during
      // beforeunload. Keep the tab open with the native warning instead of
      // pretending an unreliable last-second save was attempted.
      event.preventDefault()
      event.returnValue = ''
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
    titleRef.current = value
    if (!articleIdRef.current) {
      const nextSlug = slugify(value, { lower: true, strict: true, trim: true })
      setSlugState(nextSlug)
      slugRef.current = nextSlug
    }
    scheduleAutosave()
  }

  const handleContentChange = useCallback((nextContent: string) => {
    setContent(nextContent)
    contentRef.current = nextContent
    scheduleAutosave()
  }, [scheduleAutosave])

  const handleSave = async (overrideStatus?: string) => {
    if (overrideStatus && overrideStatus !== 'DRAFT' && !titleRef.current.trim()) {
      setError(localEditorError('A title is required before publishing or submitting.'))
      setSaveStatus('error')
      return
    }
    clearTimeout(autoSaveTimer.current)
    setError(null)
    const saved = await performSave(overrideStatus)

    if (!saved || !articleIdRef.current) return
    if (overrideStatus && articleId) router.refresh()
  }

  const handleBack = async () => {
    if (isDirtyRef.current && canEdit) {
      clearTimeout(autoSaveTimer.current)
      const saved = await performSave()
      // Stay in the editor if saving failed or if another edit was made while
      // the queued request was in flight.
      if (!saved || isDirtyRef.current) return
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
      const data = await apiRequest<{ url?: string }>('/api/upload', {
        method: 'POST',
        body: form,
      })
      if (!data.url) {
        throw new ApiError('server', 'The upload completed without returning an image URL.')
      }
      setCoverImageState(data.url)
      coverImageRef.current = data.url
      scheduleAutosave()
    } catch (reason) {
      setCoverError(asApiError(reason).message)
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
    statusIntentVersionRef.current += 1
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
