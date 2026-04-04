'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'

interface Category {
  id: string
  name: string
  slug: string
}

interface CategoryTabsProps {
  categories: Category[]
  currentSlug?: string
}

export function CategoryTabs({ categories, currentSlug }: CategoryTabsProps) {
  const tabs = [
    { href: '/', label: 'All', slug: undefined as string | undefined },
    ...categories.map((c) => ({ href: `/?category=${c.slug}`, label: c.name, slug: c.slug })),
  ]

  return (
    <div className="border-b border-[var(--border)] mb-6">
      <div
        className="flex overflow-x-auto scrollbar-none gap-0"
        role="tablist"
        aria-label="Article categories"
      >
        {tabs.map((tab) => {
          const isActive = tab.slug === currentSlug
          return (
            <Link
              key={tab.href}
              href={tab.href}
              role="tab"
              aria-selected={isActive}
              className={`relative flex-shrink-0 px-5 py-3 text-[0.7rem] font-bold tracking-widest uppercase whitespace-nowrap transition-colors duration-200 ${
                isActive
                  ? 'text-gold'
                  : 'text-[var(--fg-muted)] hover:text-[var(--fg)]'
              }`}
            >
              {tab.label}
              {isActive && (
                <motion.span
                  layoutId="category-tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-gold"
                  transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                />
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
