'use client'

import { useState } from 'react'

export function ContactForm() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  })
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('loading')
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error()
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-8 text-center">
        <div className="w-12 h-12 bg-gold/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-gold text-xl">✓</span>
        </div>
        <h3
          className="text-[var(--fg)] font-bold text-xl mb-2"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Message sent
        </h3>
        <p className="text-[var(--fg-muted)] text-sm">
          Thank you for reaching out. We&apos;ll get back to you as soon as possible.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-[var(--bg-elevated)] border border-[var(--border)] p-6 sm:p-8 space-y-5"
    >
      {status === 'error' && (
        <p className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 px-4 py-3">
          Something went wrong. Please try again or email us directly.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label className="block text-[var(--fg)] text-xs font-bold uppercase tracking-widest mb-2">
            Name <span className="text-gold">*</span>
          </label>
          <input
            type="text"
            name="name"
            value={form.name}
            onChange={handleChange}
            required
            className="w-full border border-[var(--border)] px-4 py-3 text-[var(--fg)] text-sm focus:outline-none focus:border-gold transition-colors bg-[var(--bg)]"
            placeholder="Your full name"
          />
        </div>
        <div>
          <label className="block text-[var(--fg)] text-xs font-bold uppercase tracking-widest mb-2">
            Email <span className="text-gold">*</span>
          </label>
          <input
            type="email"
            name="email"
            value={form.email}
            onChange={handleChange}
            required
            className="w-full border border-[var(--border)] px-4 py-3 text-[var(--fg)] text-sm focus:outline-none focus:border-gold transition-colors bg-[var(--bg)]"
            placeholder="your@email.com"
          />
        </div>
      </div>

      <div>
        <label className="block text-[var(--fg)] text-xs font-bold uppercase tracking-widest mb-2">
          Subject <span className="text-gold">*</span>
        </label>
        <select
          name="subject"
          value={form.subject}
          onChange={handleChange}
          required
          className="w-full border border-[var(--border)] px-4 py-3 text-[var(--fg)] text-sm focus:outline-none focus:border-gold transition-colors bg-[var(--bg)]"
        >
          <option value="">Select a subject</option>
          <option value="writing">I&apos;d like to write for The Consilium</option>
          <option value="story">Story tip or idea</option>
          <option value="collaboration">Collaboration enquiry</option>
          <option value="feedback">Feedback</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div>
        <label className="block text-[var(--fg)] text-xs font-bold uppercase tracking-widest mb-2">
          Message <span className="text-gold">*</span>
        </label>
        <textarea
          name="message"
          value={form.message}
          onChange={handleChange}
          required
          rows={6}
          className="w-full border border-[var(--border)] px-4 py-3 text-[var(--fg)] text-sm focus:outline-none focus:border-gold transition-colors bg-[var(--bg)] resize-none"
          placeholder="Your message..."
        />
      </div>

      <button
        type="submit"
        disabled={status === 'loading'}
        className="w-full bg-navy text-gold py-3 text-sm font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors disabled:opacity-60"
      >
        {status === 'loading' ? 'Sending...' : 'Send Message'}
      </button>
    </form>
  )
}
