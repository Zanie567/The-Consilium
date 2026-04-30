'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { Search, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import { displayAuthorName } from '@/lib/authorUtils'

interface SearchResult {
  id: string
  title: string
  slug: string
  excerpt: string | null
  snippet: string
  coverImage: string | null
  publishedAt: string | null
  author: { id: string; name: string | null; slug: string | null }
  category: { name: string; slug: string } | null
}

function highlight(text: string, query: string): string {
  if (!query.trim()) return text
  const tokens = query.trim().split(/\s+/).filter((t) => t.length >= 2)
  if (tokens.length === 0) return text
  const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return text.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>')
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } },
}

function SearchContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const initial = searchParams.get('q') ?? ''

  const [query, setQuery] = useState(initial)
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [resultsKey, setResultsKey] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); setSearched(false); return }
    setLoading(true)
    setSearched(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setResults(Array.isArray(data) ? data : [])
      setResultsKey((k) => k + 1)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Run search when page loads with ?q= param
  useEffect(() => {
    if (initial) doSearch(initial)
    inputRef.current?.focus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      router.replace(val.trim() ? `/search?q=${encodeURIComponent(val.trim())}` : '/search', {
        scroll: false,
      })
      doSearch(val)
    }, 280)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    router.replace(query.trim() ? `/search?q=${encodeURIComponent(query.trim())}` : '/search', {
      scroll: false,
    })
    doSearch(query)
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Search header */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="bg-navy border-b-2 border-gold py-14 px-4"
      >
        <div className="max-w-2xl mx-auto text-center">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05 }}
            className="text-gold/60 text-[0.65rem] tracking-[0.3em] uppercase font-semibold mb-3"
          >
            The Consilium
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-3xl sm:text-4xl font-bold text-cream mb-8"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Search
          </motion.h1>
          <motion.form
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.18 }}
            onSubmit={handleSubmit}
            className="relative"
          >
            <Search
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-gold/60 pointer-events-none"
            />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={handleChange}
              placeholder="Search articles, authors, topics..."
              autoComplete="off"
              spellCheck="false"
              className="w-full bg-white/[0.08] border border-gold/60 focus:border-gold text-cream placeholder-cream/60 text-base pl-12 pr-5 py-4 outline-none transition-colors duration-200"
              style={{ fontFamily: 'var(--font-sans)' }}
            />
            {loading && (
              <Loader2
                size={16}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gold/60 animate-spin"
              />
            )}
          </motion.form>
        </div>
      </motion.div>

      {/* Results */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <AnimatePresence mode="wait">
          {!searched && query.length < 2 && (
            <motion.p
              key="hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="text-center text-[var(--fg-faint)] text-sm py-10"
            >
              Start typing to search across all articles.
            </motion.p>
          )}

          {searched && !loading && results.length === 0 && (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="text-center py-14"
            >
              <p
                className="text-2xl font-bold text-[var(--fg)] mb-3"
                style={{ fontFamily: 'var(--font-serif)' }}
              >
                No results found
              </p>
              <p className="text-[var(--fg-muted)] text-sm">
                Try different keywords, check for spelling, or{' '}
                <Link href="/archive" className="text-gold hover:underline">
                  browse all articles
                </Link>
                .
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {results.length > 0 && (
          <motion.div
            key={resultsKey}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="text-[var(--fg-faint)] text-xs uppercase tracking-widest font-semibold mb-6"
            >
              {results.length} result{results.length !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
            </motion.p>
            <motion.div
              variants={{
                hidden: {},
                visible: { transition: { staggerChildren: 0.06 } },
              }}
              initial="hidden"
              animate="visible"
              className="space-y-0 divide-y divide-[var(--border)]"
            >
              {results.map((result) => (
                <motion.article
                  key={result.id}
                  variants={itemVariants}
                  className="py-7 flex gap-5 group"
                >
                  {/* Thumbnail */}
                  <Link
                    href={`/articles/${result.slug}`}
                    className="shrink-0 w-24 h-16 sm:w-32 sm:h-22 relative overflow-hidden bg-navy/10"
                  >
                    {result.coverImage ? (
                      <Image
                        src={result.coverImage}
                        alt={result.title}
                        fill
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-navy to-navy-light flex items-center justify-center">
                        <span
                          className="text-gold/20 text-2xl font-bold select-none"
                          style={{ fontFamily: 'var(--font-serif)' }}
                        >
                          TC
                        </span>
                      </div>
                    )}
                  </Link>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {result.category && (
                      <Link
                        href={`/category/${result.category.slug}`}
                        className="inline-block category-badge mb-2 hover:opacity-80 transition-opacity"
                      >
                        {result.category.name}
                      </Link>
                    )}
                    <Link href={`/articles/${result.slug}`}>
                      <h2
                        className="font-bold text-[var(--fg)] text-base sm:text-lg leading-snug mb-2 group-hover:text-gold transition-colors duration-200 line-clamp-2"
                        style={{ fontFamily: 'var(--font-serif)' }}
                        dangerouslySetInnerHTML={{ __html: highlight(result.title, query) }}
                      />
                    </Link>
                    <p
                      className="text-[var(--fg-muted)] text-sm leading-relaxed line-clamp-2 mb-3"
                      dangerouslySetInnerHTML={{ __html: highlight(result.snippet, query) }}
                    />
                    <div className="flex items-center gap-2 text-[0.7rem] text-[var(--fg-faint)]">
                      {result.author.name && (
                        <Link
                          href={`/author/${result.author.slug ?? result.author.id}`}
                          className="font-semibold text-[var(--fg-muted)] hover:text-gold transition-colors"
                        >
                          {displayAuthorName(result.author.name)}
                        </Link>
                      )}
                      {result.author.name && result.publishedAt && (
                        <span className="text-gold/30">·</span>
                      )}
                      {result.publishedAt && (
                        <span>{format(new Date(result.publishedAt), 'd MMM yyyy')}</span>
                      )}
                    </div>
                  </div>
                </motion.article>
              ))}
            </motion.div>
          </motion.div>
        )}
      </div>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchContent />
    </Suspense>
  )
}
