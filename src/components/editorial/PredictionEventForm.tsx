'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface PredictionEventFormValues {
  title: string
  description: string
  type: 'BOE_RATE' | 'CPI_YOY' | 'OTHER'
  fredSeriesId: string
  unitLabel: string
  /** datetime-local format, yyyy-MM-ddTHH:mm, in the admin's local time. */
  deadline: string
  releaseDate: string
  minValue: string
  maxValue: string
  maxError: string
}

interface Props {
  /** When set, the form edits an existing event instead of creating one. */
  eventId?: string
  initialValues?: PredictionEventFormValues
}

const EMPTY: PredictionEventFormValues = {
  title: '',
  description: '',
  type: 'BOE_RATE',
  fredSeriesId: 'BOEBR',
  unitLabel: '%',
  deadline: '',
  releaseDate: '',
  minValue: '0',
  maxValue: '10',
  maxError: '1',
}

// Sensible starting points per event type, applied only when the admin has not
// already customised the fields they cover.
const TYPE_PRESETS: Record<string, Partial<PredictionEventFormValues>> = {
  BOE_RATE: { fredSeriesId: 'BOEBR', unitLabel: '%', minValue: '0', maxValue: '10', maxError: '0.5' },
  CPI_YOY: { fredSeriesId: 'GBRCPIALLMINMEI', unitLabel: '% y/y', minValue: '-2', maxValue: '15', maxError: '1' },
  OTHER: { fredSeriesId: '', unitLabel: '%', minValue: '0', maxValue: '100', maxError: '1' },
}

const inputClass =
  'w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] focus:border-gold focus:outline-none'
const labelClass = 'block text-xs uppercase tracking-widest text-[var(--fg-muted)] mb-1.5'

export function PredictionEventForm({ eventId, initialValues }: Props) {
  const router = useRouter()
  const [values, setValues] = useState<PredictionEventFormValues>(initialValues ?? EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof PredictionEventFormValues>(key: K, value: PredictionEventFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  function applyTypePreset(type: PredictionEventFormValues['type']) {
    setValues((v) => ({ ...v, type, ...TYPE_PRESETS[type] }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload = {
        ...(eventId ? { action: 'update' } : {}),
        title: values.title,
        description: values.description.trim() === '' ? null : values.description,
        type: values.type,
        fredSeriesId: values.fredSeriesId.trim() === '' ? null : values.fredSeriesId.trim(),
        unitLabel: values.unitLabel,
        // datetime-local values are in the admin's local time; Date converts
        // them to an absolute instant before sending.
        deadline: values.deadline ? new Date(values.deadline).toISOString() : '',
        releaseDate: values.releaseDate ? new Date(values.releaseDate).toISOString() : '',
        minValue: values.minValue,
        maxValue: values.maxValue,
        maxError: values.maxError,
      }
      const res = await fetch(
        eventId ? `/api/editorial/predictions/${eventId}` : '/api/editorial/predictions',
        {
          method: eventId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Saving failed. Please try again.')
        return
      }
      router.push('/editorial/predictions')
      router.refresh()
    } catch {
      setError('Saving failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5 max-w-2xl">
      <div>
        <label htmlFor="ev-title" className={labelClass}>Title</label>
        <input
          id="ev-title"
          type="text"
          required
          maxLength={200}
          value={values.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Bank Rate decision, August 2026"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="ev-description" className={labelClass}>Description (optional)</label>
        <textarea
          id="ev-description"
          rows={3}
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="What should readers predict, and any context worth knowing."
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="ev-type" className={labelClass}>Type</label>
          <select
            id="ev-type"
            value={values.type}
            onChange={(e) => applyTypePreset(e.target.value as PredictionEventFormValues['type'])}
            className={inputClass}
          >
            <option value="BOE_RATE">Bank of England rate</option>
            <option value="CPI_YOY">CPI, year on year</option>
            <option value="OTHER">Other</option>
          </select>
          <p className="text-[11px] text-[var(--fg-faint)] mt-1">
            Changing the type refills the FRED series, unit, bounds, and max error with presets.
          </p>
        </div>
        <div>
          <label htmlFor="ev-fred" className={labelClass}>FRED series id (optional)</label>
          <input
            id="ev-fred"
            type="text"
            value={values.fredSeriesId}
            onChange={(e) => set('fredSeriesId', e.target.value)}
            placeholder="BOEBR"
            className={inputClass}
          />
          <p className="text-[11px] text-[var(--fg-faint)] mt-1">
            Leave empty for events you will resolve by hand.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="ev-deadline" className={labelClass}>Submission deadline</label>
          <input
            id="ev-deadline"
            type="datetime-local"
            required
            value={values.deadline}
            onChange={(e) => set('deadline', e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ev-release" className={labelClass}>Expected release</label>
          <input
            id="ev-release"
            type="datetime-local"
            required
            value={values.releaseDate}
            onChange={(e) => set('releaseDate', e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <label htmlFor="ev-unit" className={labelClass}>Unit label</label>
          <input
            id="ev-unit"
            type="text"
            required
            maxLength={20}
            value={values.unitLabel}
            onChange={(e) => set('unitLabel', e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ev-min" className={labelClass}>Min value</label>
          <input
            id="ev-min"
            type="number"
            step="any"
            required
            value={values.minValue}
            onChange={(e) => set('minValue', e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ev-max" className={labelClass}>Max value</label>
          <input
            id="ev-max"
            type="number"
            step="any"
            required
            value={values.maxValue}
            onChange={(e) => set('maxValue', e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ev-maxerror" className={labelClass}>Max error</label>
          <input
            id="ev-maxerror"
            type="number"
            step="any"
            min="0.0001"
            required
            value={values.maxError}
            onChange={(e) => set('maxError', e.target.value)}
            className={inputClass}
          />
          <p className="text-[11px] text-[var(--fg-faint)] mt-1">
            Error at which points hit zero.
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="bg-navy text-cream text-xs font-bold uppercase tracking-widest px-5 py-2.5 hover:bg-navy/90 transition-colors disabled:opacity-50 min-h-[44px]"
        >
          {saving ? 'Saving...' : eventId ? 'Save changes' : 'Create event'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/editorial/predictions')}
          className="text-xs uppercase tracking-widest text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors"
        >
          Back
        </button>
      </div>
    </form>
  )
}
