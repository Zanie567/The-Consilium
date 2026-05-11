'use client'

import type React from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  Heading2,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Moon,
  Quote,
  Strikethrough,
  Table,
  Type,
  Underline,
  Upload,
} from 'lucide-react'
import type { ArticleEditorController } from './types'

interface ArticleEditorTutorialProps {
  editor: ArticleEditorController
}

export function ArticleEditorTutorial({ editor }: ArticleEditorTutorialProps) {
  if (!editor.tutorialOpen) return null

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/40" onClick={() => editor.actions.setTutorialOpen(false)} />
      <div className="fixed inset-0 z-[71] flex items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-[680px] max-h-[80vh] bg-[var(--bg-elevated)] rounded-2xl shadow-2xl flex flex-col border border-[var(--border)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0">
            <h2 className="text-[15px] font-serif font-semibold text-[var(--fg)]">How to use the article editor</h2>
            <button
              onClick={() => editor.actions.setTutorialOpen(false)}
              aria-label="Close tutorial"
              className="w-7 h-7 flex items-center justify-center rounded text-[var(--fg-faint)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)] transition-colors text-[18px] leading-none"
            >
              ×
            </button>
          </div>

          <div className="overflow-y-auto px-6 py-5 space-y-0 text-[14px] leading-[1.7] text-[var(--fg)]">
            <TutorialSection title="Getting started">
              <p>Your article auto-saves as you type. You will see &ldquo;Saving&rdquo; then &ldquo;Saved&rdquo; in the top bar. Click &ldquo;Save draft&rdquo; to save manually at any time.</p>
            </TutorialSection>

            <TutorialSection title="Formatting buttons">
              <TutorialList>
                <TutorialItem label="Bold" icon={<Bold size={13} />}>Makes selected text bold</TutorialItem>
                <TutorialItem label="Italic" icon={<Italic size={13} />}>Makes selected text italic</TutorialItem>
                <TutorialItem label="Underline" icon={<Underline size={13} />}>Underlines selected text</TutorialItem>
                <TutorialItem label="Strikethrough" icon={<Strikethrough size={13} />}>Draws a line through selected text</TutorialItem>
                <TutorialItem label="Text colour" icon={<Type size={13} />}>Select text, then pick a colour from the grid</TutorialItem>
                <TutorialItem label="Highlight" icon={<Highlighter size={13} />}>Background colour behind selected text</TutorialItem>
              </TutorialList>
            </TutorialSection>

            <TutorialSection title="Structure buttons">
              <TutorialList>
                <TutorialItem label="Headings" icon={<Heading2 size={13} />}>H2 is a main section, H3 a sub-section.</TutorialItem>
                <TutorialItem label="Bullet list" icon={<List size={13} />}>Press Tab to indent a level deeper</TutorialItem>
                <TutorialItem label="Numbered list" icon={<ListOrdered size={13} />}>Ordered list with automatic numbering</TutorialItem>
                <TutorialItem label="Blockquote" icon={<Quote size={13} />}>Pull quote with gold left border</TutorialItem>
                <TutorialItem label="Code block" icon={<Code2 size={13} />}>Monospaced formatting for code or data</TutorialItem>
              </TutorialList>
            </TutorialSection>

            <TutorialSection title="Insert buttons">
              <TutorialList>
                <TutorialItem label="Link" icon={<Link2 size={13} />}>Highlight text first, then click to add a URL</TutorialItem>
                <TutorialItem label="Image" icon={<Upload size={13} />}>Inserts an image at the cursor position</TutorialItem>
                <TutorialItem label="Table" icon={<Table size={13} />}>Hover the grid to choose size, click to insert</TutorialItem>
                <TutorialItem label="Horizontal rule" icon={<Minus size={13} />}>Dividing line across the page</TutorialItem>
              </TutorialList>
            </TutorialSection>

            <TutorialSection title="Alignment">
              <TutorialList>
                <TutorialItem label="Align left" icon={<AlignLeft size={13} />}>Left-aligns the current paragraph</TutorialItem>
                <TutorialItem label="Align centre" icon={<AlignCenter size={13} />}>Centres the current paragraph</TutorialItem>
                <TutorialItem label="Align right" icon={<AlignRight size={13} />}>Right-aligns the current paragraph</TutorialItem>
              </TutorialList>
            </TutorialSection>

            <TutorialSection title="Right panel">
              <TutorialList>
                <TutorialItem label="Status">Draft while writing. Publish when ready, or submit for review.</TutorialItem>
                <TutorialItem label="Author">Editors and admins can reassign the article.</TutorialItem>
                <TutorialItem label="Category">Assign to News, Opinion, Analysis etc.</TutorialItem>
                <TutorialItem label="Cover image">Paste a URL or upload a file</TutorialItem>
                <TutorialItem label="Tags">Up to 10 tags. Press Enter or comma after each.</TutorialItem>
                <TutorialItem label="URL slug">Auto-generated from the headline, editable</TutorialItem>
              </TutorialList>
            </TutorialSection>

            <TutorialSection title="Dark mode">
              <TutorialList>
                <TutorialItem label="Moon / Sun" icon={<Moon size={13} />}>Click to toggle dark mode. Preference is saved automatically.</TutorialItem>
              </TutorialList>
            </TutorialSection>

            <TutorialSection title="Word count" last>
              <p>Updates live as you type, shown next to the read time in the right panel.</p>
            </TutorialSection>
          </div>
        </div>
      </div>
    </>
  )
}

function TutorialSection({ title, children, last }: { title: string; children?: React.ReactNode; last?: boolean }) {
  return (
    <div className={`py-4 ${last ? '' : 'border-b border-[var(--border)]'}`}>
      <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-faint)] mb-2">{title}</p>
      {children}
    </div>
  )
}

function TutorialList({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-2 mt-1">{children}</ul>
}

function TutorialItem({ label, icon, children }: { label: string; icon?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="shrink-0 w-[26px] h-[26px] flex items-center justify-center rounded border border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--fg-muted)]">
        {icon ?? <span className="text-[10px] font-bold leading-none">{label.slice(0, 2)}</span>}
      </span>
      <span className="flex-1 pt-[3px]">
        <span className="font-medium text-[var(--fg)]">{label}</span>
        {children && <span className="text-[var(--fg-muted)]">: {children}</span>}
      </span>
    </li>
  )
}
