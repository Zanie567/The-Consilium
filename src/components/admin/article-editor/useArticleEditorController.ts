'use client'

import { topicDisplayName, canonicalTagSlug } from '@/lib/tagIdentity'

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import slugify from 'slugify'
import { mutate as globalMutate } from 'swr'
import { DRAFTS_SWR_KEY } from '@/components/editorial/DraftsSection'
import { ApiError, apiRequest, asApiError } from '@/lib/apiClient'
import { ARTICLE_IMAGE_TOO_LARGE_MESSAGE, MAX_ARTICLE_IMAGE_BYTES } from '@/lib/constants'
import type {
  StatusAction,
  ArticleEditorController,
  ArticleEditorError,
  ArticleEditorHookProps,
  SaveStatus,
  UserOption,
} from './types'
import { readDrafts, storeDraft, deleteDraft, type LocalDraft } from '@/lib/draftRecovery'
import { STATUS_LABELS } from './constants'

interface SavedArticleResponse {
  id?: string
  updatedAt?: string
  status?: string
  /** Server-computed fingerprint of the saved fields (see src/lib/articleVersion.ts). */
  version?: string
}

function localEditorError(message: string): ArticleEditorError {
  return { kind: 'editor-validation', label: 'Check article details', message }
}

function articleSaveError(reason: unknown): ArticleEditorError {
  const error = asApiError(reason)
  const base = { kind: error.kind, requestId: error.requestId, code: error.code }

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
      if (error.code === 'PUBLICATION_CONFIRMATION_REQUIRED') {
        return {
          ...base,
          label: 'Status changed elsewhere',
          message: 'This article\'s published status was changed in another tab or by someone else, so this tab cannot save over it. Nothing was saved or published. Copy any text you need, then reload to see the current status.',
        }
      }
      if (error.code === 'ARTICLE_CONFLICT') {
        return {
          ...base,
          label: 'Changed elsewhere',
          message: `${error.message} Nothing was saved. Your changes are still in this tab: keep them to replace the newer version, or reload to discard them and see what changed.`,
        }
      }
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
  // The status the SERVER holds: moves only when a save succeeds. Drives what the page lets
  // the writer do (a submitted article is locked) without needing a reload.
  const [currentStatus, setCurrentStatus] = useState(initialData?.status ?? 'DRAFT')
  const [scheduledAt, setScheduledAtState] = useState(initialData?.scheduledAt ?? '')
  const [tags, setTags] = useState<string[]>(initialData?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [selectedAuthorId, setSelectedAuthorIdState] = useState(initialData?.authorId ?? authorId)
  const [users, setUsers] = useState<UserOption[]>([])

  // An existing server-loaded revision is persisted; acknowledge it until
  // subsequent edits make the document dirty. Draft creation preserves this
  // controller and updates the address bar without remounting it.
  const loadedSavedRevision = Boolean(articleId && initialData?.updatedAt)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(loadedSavedRevision ? 'saved' : 'idle')
  const [savedVisible, setSavedVisible] = useState(loadedSavedRevision)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<ArticleEditorError | null>(null)
  const [coverError, setCoverError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)

  const articleIdRef = useRef<string | undefined>(articleId)
  const revisionRef = useRef(initialData?.updatedAt)
  // Fingerprint of the article as this tab last saw it; sent so a stale tab is refused.
  const versionRef = useRef<string | undefined>(initialData?.version)
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
  // The status the SERVER holds. Ordinary saves (autosave, Save draft) send exactly this, so they can
  // never change visibility; only an explicit action passes a different one.
  const currentStatusRef = useRef(initialData?.status ?? 'DRAFT')
  const confirmingRef = useRef(false)
  const scheduledAtRef = useRef(scheduledAt)
  const tagsRef = useRef(tags)
  const selectedAuthorIdRef = useRef(selectedAuthorId)

  const canEdit = !isWriter || currentStatus === 'DRAFT' || currentStatus === 'REJECTED'
  const [recovery, setRecovery] = useState<{ at: number; stale: boolean } | null>(null)
  const [recovered, setRecovered] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')
  const [recoveryRevision, setRecoveryRevision] = useState(0)
  const recoveryDraftRef = useRef<LocalDraft | null>(null)
  const localDraftRef = useRef<LocalDraft | null>(null)
  const tabIdRef = useRef('')
  const recoveryBlockedRef = useRef(false)

  useEffect(() => {
    try {
      tabIdRef.current = sessionStorage.getItem('consilium:editor-tab') ?? crypto.randomUUID()
      sessionStorage.setItem('consilium:editor-tab', tabIdRef.current)
      const drafts = readDrafts(localStorage, authorId, articleId ?? 'new')
      const draft = drafts.find(d => d.fields.content !== (initialData?.content ?? '') || d.fields.title !== (initialData?.title ?? '') || d.fields.excerpt !== (initialData?.excerpt ?? '') || d.baseVersion !== initialData?.version)
      if (draft) {
        recoveryDraftRef.current = draft
        recoveryBlockedRef.current = true
        setRecovery({ at: draft.at, stale: draft.baseVersion !== initialData?.version })
      }
    } catch {
      setRecoveryError('Local draft recovery is unavailable in this browser. Keep this tab open until saving succeeds.')
    }
  }, [authorId, articleId, initialData])

  const persistLocalDraft = useCallback(() => {
    if (!isDirtyRef.current || !tabIdRef.current) return
    const draft: LocalDraft = {
      userId: authorId, articleId: articleIdRef.current ?? 'new', tabId: tabIdRef.current,
      at: Date.now(), baseVersion: versionRef.current,
      fields: { title: titleRef.current, slug: slugRef.current, content: contentRef.current,
        excerpt: excerptRef.current, coverImage: coverImageRef.current, categoryId: categoryIdRef.current,
        tags: tagsRef.current, authorId: selectedAuthorIdRef.current },
    }
    try {
      storeDraft(localStorage, draft)
      if (localDraftRef.current && localDraftRef.current.articleId !== draft.articleId) deleteDraft(localStorage, localDraftRef.current)
      localDraftRef.current = draft
    } catch {
      setRecoveryError('Could not retain a local recovery copy. Keep this tab open until saving succeeds.')
    }
  }, [authorId])

  const clearLocalDraft = useCallback(() => {
    try {
      if (localDraftRef.current) deleteDraft(localStorage, localDraftRef.current)
      if (recoveryDraftRef.current) deleteDraft(localStorage, recoveryDraftRef.current)
      localDraftRef.current = null
      recoveryDraftRef.current = null
    } catch { setRecoveryError('Could not remove the local recovery copy.') }
  }, [])

  const discardLocalDraft = () => {
    clearLocalDraft()
    recoveryBlockedRef.current = false
    setRecovery(null)
    setRecovered(false)
  }

  const restoreLocalDraft = () => {
    const draft = recoveryDraftRef.current
    if (!draft || !canEdit) return
    const f = draft.fields
    setTitle(f.title); titleRef.current = f.title
    setSlugState(f.slug); slugRef.current = f.slug
    setContent(f.content); contentRef.current = f.content
    setExcerptState(f.excerpt); excerptRef.current = f.excerpt
    setCoverImageState(f.coverImage); coverImageRef.current = f.coverImage
    setCategoryIdState(f.categoryId); categoryIdRef.current = f.categoryId
    setTags(f.tags); tagsRef.current = f.tags
    setSelectedAuthorIdState(f.authorId); selectedAuthorIdRef.current = f.authorId
    // Keep the recovery's original base: a newer server version must produce 409.
    versionRef.current = draft.baseVersion
    isDirtyRef.current = true
    editVersionRef.current++
    recoveryBlockedRef.current = true
    setRecovery(null); setRecovered(true); setSaveStatus('idle')
    setRecoveryRevision(v => v + 1)
    persistLocalDraft()
  }


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
  useEffect(() => { scheduledAtRef.current = scheduledAt }, [scheduledAt])
  useEffect(() => { tagsRef.current = tags }, [tags])
  useEffect(() => { selectedAuthorIdRef.current = selectedAuthorId }, [selectedAuthorId])

  useEffect(() => {
    const elements = [titleDomRef.current, excerptDomRef.current].filter((element): element is HTMLTextAreaElement => Boolean(element))
    const resize = () => { for (const element of elements) { element.style.height = 'auto'; element.style.height = `${element.scrollHeight}px` } }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    for (const element of elements) if (element.parentElement) observer?.observe(element.parentElement)
    resize()
    void document.fonts?.ready.then(resize)
    return () => observer?.disconnect()
  }, [title, excerpt, titleDomRef, excerptDomRef])

  const performSave = useCallback((explicitStatus?: string): Promise<boolean> => {
    const requestedStatus = explicitStatus ?? currentStatusRef.current
    const requestNumber = ++saveRequestRef.current
    latestSaveRequestRef.current = requestNumber

    if (requestedStatus === 'SCHEDULED' && !scheduledAtRef.current) {
      setError(localEditorError('Please pick a future date and time to schedule this article.'))
      setSaveStatus('error')
      return Promise.resolve(false)
    }

    // A status button is an intent of its own. Remember its sequence so an
    // older publish/submit response cannot overwrite a newer status selection.
    const statusIntentVersion = explicitStatus
      ? ++statusIntentVersionRef.current
      : statusIntentVersionRef.current

    clearTimeout(savedFadeTimer.current)
    clearTimeout(savedTimeoutRef.current)
    setSaveStatus('saving')
    setSavedVisible(false)
    setError(null)

    const execute = async (): Promise<boolean> => {
      try {
        // Snapshot only when this queued save begins. An ordinary save sends the status the
        // server holds NOW, so one queued behind a publish sees whether it succeeded (and does
        // not revert it), and one queued behind a FAILED publish does not retry it.
        const finalStatus = explicitStatus ?? currentStatusRef.current
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
          ...(revisionRef.current ? { expectedUpdatedAt: revisionRef.current } : {}),
          tags: tagsRef.current,
          // Only an explicit publish / schedule / unpublish / submit action says so; the server
          // refuses any visibility change without it (PUBLICATION_CONFIRMATION_REQUIRED).
          ...(explicitStatus ? { publicationIntent: true } : {}),
          ...(versionRef.current ? { baseVersion: versionRef.current } : {}),
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
          revisionRef.current = saved.updatedAt
          if (saved.version) versionRef.current = saved.version
          // Put the article's own URL in the address bar WITHOUT navigating. A router
          // navigation here re-mounted the whole editor (new route segment), and any
          // keystroke typed between the save and the re-mount was silently discarded.
          window.history.replaceState(window.history.state, '', `/editorial/articles/${saved.id}/edit`)

          if (finalStatus !== 'DRAFT') {
            saved = await apiRequest<SavedArticleResponse>(`/api/articles/${saved.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...body, expectedUpdatedAt: revisionRef.current, ...(versionRef.current ? { baseVersion: versionRef.current } : {}) }),
            })
          }
        }
        if (saved.version) versionRef.current = saved.version
        if (saved.status) {
          currentStatusRef.current = saved.status
          setCurrentStatus(saved.status)
        }

        revisionRef.current = saved.updatedAt ?? revisionRef.current

        if (explicitStatus && statusIntentVersion === statusIntentVersionRef.current) {
          setStatusState(saved.status ?? explicitStatus)
        }

        // A response only acknowledges the exact snapshot it sent. Edits made
        // while this request was in flight stay dirty until their own queued save
        // succeeds.
        if (editVersion === editVersionRef.current) {
          isDirtyRef.current = false
          clearLocalDraft()
          setRecovered(false)
        } else persistLocalDraft()

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
  }, [clearLocalDraft, persistLocalDraft])

  const scheduleAutosave = useCallback(() => {
    if (!canEdit) return
    editVersionRef.current += 1
    isDirtyRef.current = true
    clearTimeout(savedFadeTimer.current)
    clearTimeout(savedTimeoutRef.current)
    setSavedVisible(false)
    persistLocalDraft()
    clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      if (!recoveryBlockedRef.current) void performSave()
    }, 2000)
  }, [canEdit, performSave, persistLocalDraft])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isDirtyRef.current && canEdit && !recoveryBlockedRef.current) {
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
    // Record the edit and schedule its save BEFORE asking React to re-render. If the
    // re-render throws (React's nested-update limit can, under sustained typing), the
    // edit must still reach the autosave; the save reads contentRef, not state.
    contentRef.current = nextContent
    scheduleAutosave()
    setContent(nextContent)
  }, [scheduleAutosave])

  const handleSave = async (explicitStatus?: string) => {
    if (explicitStatus && explicitStatus !== 'DRAFT' && !titleRef.current.trim()) {
      setError(localEditorError('A title is required before publishing or submitting.'))
      setSaveStatus('error')
      return
    }
    clearTimeout(autoSaveTimer.current)
    setError(null)
    if (recovery) return
    recoveryBlockedRef.current = false
    const saved = await performSave(explicitStatus)

    if (!saved || !articleIdRef.current) return
    if (explicitStatus && articleId) router.refresh()
  }

  // ── Status changes that alter what the public sees are explicit, and confirmed ──────────
  const [pendingStatus, setPendingStatus] = useState<string | null>(null)

  const requestStatusChange = (target: string) => {
    if (target === 'SCHEDULED' && !scheduledAtRef.current) {
      setError(localEditorError('Please pick a future date and time to schedule this article.'))
      setSaveStatus('error')
      return
    }
    if (!titleRef.current.trim() && target !== 'DRAFT') {
      setError(localEditorError('A title is required before publishing or submitting.'))
      setSaveStatus('error')
      return
    }
    const current = currentStatusRef.current
    const touchesPublic = ['PUBLISHED', 'SCHEDULED'].includes(target) || ['PUBLISHED', 'SCHEDULED'].includes(current)
    if (touchesPublic) setPendingStatus(target)
    else void handleSave(target)
  }

  const cancelStatusChange = () => {
    if (!confirmingRef.current) setPendingStatus(null)
  }

  const confirmStatusChange = async () => {
    const target = pendingStatus
    // A second click while the first is in flight (double-click, key repeat) does nothing.
    if (!target || confirmingRef.current) return
    confirmingRef.current = true
    try {
      await handleSave(target)
    } finally {
      confirmingRef.current = false
      setPendingStatus(null)
    }
  }

  const keepMyVersion = async () => {
    // Rebase this explicit choice on a fresh revision, preserving both guards
    // against another change between this read and the ensuing write.
    clearTimeout(autoSaveTimer.current)
    await saveQueueRef.current
    try {
      const latest = await apiRequest<SavedArticleResponse>(`/api/articles/${articleIdRef.current}`, { cache: 'no-store' })
      if (!latest.version || !latest.updatedAt || !latest.status) {
        throw new ApiError('server', 'The latest article revision could not be loaded. Your changes remain in this tab.')
      }
      revisionRef.current = latest.updatedAt
      versionRef.current = latest.version
      currentStatusRef.current = latest.status
      setCurrentStatus(latest.status)
      await handleSave()
    } catch (reason) {
      setError(articleSaveError(reason))
      setSaveStatus('error')
    }
  }

  const reloadLatest = () => {
    clearLocalDraft()
    isDirtyRef.current = false // otherwise the browser asks "leave site?" for text being discarded
    window.location.reload()
  }

  const handleBack = async () => {
    if (recoveryBlockedRef.current) { router.push(returnUrl ?? '/editorial'); return }
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
    const name = topicDisplayName(raw)
    if (name && !tags.some(tag => canonicalTagSlug(tag) === canonicalTagSlug(name)) && tags.length < 10) {
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
    setCoverError('')
    if (file.size > MAX_ARTICLE_IMAGE_BYTES) {
      setCoverError(ARTICLE_IMAGE_TOO_LARGE_MESSAGE)
      return
    }
    setUploading(true)
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

  // Choosing a status only STAGES it. Nothing is saved or published until the matching
  // button (Publish / Schedule / Unpublish / Set to …) is pressed and, where it changes
  // what the public sees, confirmed.
  const setStatus = (value: string) => {
    statusIntentVersionRef.current += 1
    setStatusState(value)
  }

  // Likewise the publish time: changing it re-times a scheduled article, so it is applied by
  // the Schedule button, not by autosave.
  const setScheduledAt = (value: string) => {
    setScheduledAtState(value)
    scheduledAtRef.current = value
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

  // The one button that applies the staged status. Derived from what the SERVER holds
  // (currentStatus) and what the editor staged in the dropdown (status).
  const statusAction: StatusAction | null = (() => {
    if (!canPublish || !canEdit) return null
    const staged = status
    if (staged === 'SCHEDULED') return { label: 'Schedule', target: 'SCHEDULED', tone: 'schedule' }
    if (staged === currentStatus) {
      return currentStatus === 'PUBLISHED'
        ? { label: 'Unpublish', target: 'DRAFT', tone: 'unpublish' }
        : { label: 'Publish', target: 'PUBLISHED', tone: 'publish' }
    }
    if (staged === 'PUBLISHED') return { label: 'Publish', target: 'PUBLISHED', tone: 'publish' }
    return { label: `Set to ${STATUS_LABELS[staged] ?? staged}`, target: staged, tone: 'set' }
  })()

  return {
    articleId: articleIdRef.current,
    recovery, recovered, recoveryError, recoveryRevision,
    statusAction,
    pendingStatus,
    scheduledAtForDialog: scheduledAt,
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
      restoreLocalDraft, discardLocalDraft,
      requestStatusChange,
      confirmStatusChange,
      cancelStatusChange,
      addTag,
      handleBack,
      handleContentChange,
      handleCoverUpload,
      handleSave,
      keepMyVersion,
      reloadLatest,
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
