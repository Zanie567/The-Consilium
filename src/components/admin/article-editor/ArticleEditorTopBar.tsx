'use client'

import { AlertCircle, ArrowLeft, Check, Eye, Loader2, Moon, Save, Send, Settings, Sun } from 'lucide-react'
import { STATUS_COLOURS, STATUS_LABELS } from './constants'
import type { ArticleEditorController } from './types'

interface ArticleEditorTopBarProps {
  editor: ArticleEditorController
}

export function ArticleEditorTopBar({ editor }: ArticleEditorTopBarProps) {
  const { actions } = editor

  return (
    <div className="fixed top-0 left-0 md:left-12 lg:left-[220px] right-0 z-50 h-12 bg-[var(--bg-elevated)] border-b border-[var(--border)] flex items-center pl-[52px] md:pl-3 pr-3 gap-2">
      <button
        onClick={() => void actions.handleBack()}
        className="p-1.5 rounded text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-gold transition-colors shrink-0"
        aria-label="Back to articles"
      >
        <ArrowLeft size={16} />
      </button>

      <input
        type="text"
        value={editor.title}
        onChange={(event) => actions.updateTitle(event.target.value)}
        disabled={!editor.canEdit}
        placeholder="Untitled document"
        className="flex-1 min-w-0 bg-transparent border-none outline-none placeholder:text-[var(--fg-faint)] disabled:opacity-60 text-[var(--fg)] text-base"
      />

      <span className={`hidden sm:inline-flex shrink-0 items-center text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${STATUS_COLOURS[editor.status] ?? STATUS_COLOURS.DRAFT}`}>
        {STATUS_LABELS[editor.status] ?? editor.status}
      </span>

      <div className="shrink-0 flex items-center gap-1 min-w-[70px] justify-end">
        {editor.saveStatus === 'saving' && (
          <>
            <Loader2 size={11} className="animate-spin text-[var(--fg-faint)]" />
            <span className="text-[11px] text-[var(--fg-faint)] hidden sm:inline">Saving...</span>
          </>
        )}
        {editor.saveStatus === 'saved' && (
          <span
            className={`flex items-center gap-1 text-[11px] text-[var(--fg-faint)] transition-opacity duration-1000 ${editor.savedVisible ? 'opacity-100' : 'opacity-0'}`}
          >
            <Check size={11} className="text-emerald-500" />
            <span className="hidden sm:inline">Saved</span>
          </span>
        )}
        {editor.saveStatus === 'error' && (
          <>
            <AlertCircle size={11} className="text-red-400" />
            <span className="text-[11px] text-red-400 hidden sm:inline">Save failed</span>
          </>
        )}
      </div>

      {editor.articleId && editor.status === 'PUBLISHED' && (
        <a
          href={`/articles/${editor.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden md:inline-flex shrink-0 items-center gap-1 text-[var(--fg-muted)] text-[12px] px-2.5 h-8 rounded border border-[var(--border)] hover:border-gold hover:text-gold transition-colors"
        >
          <Eye size={12} />
          View live
        </a>
      )}

      {editor.themeMounted && (
        <button
          onClick={() => actions.setTheme(editor.isDark ? 'light' : 'dark')}
          aria-label={editor.isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="shrink-0 p-1.5 rounded text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-gold transition-colors"
        >
          {editor.isDark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      )}

      <button
        onClick={() => actions.setTutorialOpen(true)}
        aria-label="Open editor tutorial"
        className="shrink-0 w-7 h-7 rounded-full border border-[var(--border)] bg-transparent flex items-center justify-center text-[13px] font-medium text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-gold transition-colors"
      >
        ?
      </button>

      {editor.canEdit && (
        <button
          onClick={() => void actions.handleSave()}
          disabled={editor.saveStatus === 'saving'}
          className="hidden sm:inline-flex shrink-0 items-center gap-1 text-[var(--fg-muted)] text-[12px] px-3 h-8 rounded border border-[var(--border)] hover:border-gold hover:text-gold transition-colors disabled:opacity-50"
        >
          <Save size={12} />
          Save draft
        </button>
      )}

      {editor.canPublish && editor.canEdit && editor.status === 'SCHEDULED' && (
        <button
          onClick={() => void actions.handleSave('SCHEDULED')}
          disabled={editor.saveStatus === 'saving'}
          className="shrink-0 inline-flex items-center gap-1 bg-blue-600 text-white text-[12px] font-semibold px-3 h-8 rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          <Send size={12} />
          Schedule
        </button>
      )}
      {editor.canPublish && editor.canEdit && editor.status !== 'SCHEDULED' && (
        <button
          onClick={() => void actions.handleSave(editor.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED')}
          disabled={editor.saveStatus === 'saving'}
          className="shrink-0 inline-flex items-center gap-1 bg-navy text-gold text-[12px] font-semibold px-3 h-8 rounded hover:bg-navy-dark transition-colors disabled:opacity-50"
        >
          <Send size={12} />
          {editor.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
        </button>
      )}
      {editor.isWriter && (editor.currentStatus === 'DRAFT' || editor.currentStatus === 'REJECTED') && (
        <button
          onClick={() => void actions.handleSave('PENDING_REVIEW')}
          disabled={editor.saveStatus === 'saving'}
          className="shrink-0 inline-flex items-center gap-1 bg-amber-600 text-white text-[12px] font-semibold px-3 h-8 rounded hover:bg-amber-700 transition-colors disabled:opacity-50"
        >
          <Send size={12} />
          Submit
        </button>
      )}

      <button
        onClick={() => actions.setSettingsOpen((current) => !current)}
        className="min-[1100px]:hidden shrink-0 p-1.5 rounded text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-gold transition-colors"
        aria-label="Document settings"
      >
        <Settings size={16} />
      </button>
    </div>
  )
}
