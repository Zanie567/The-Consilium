/**
 * Deterministic situations an administrator can put a test persona into, and what that persona
 * should (and should not) then see. Pure data: nothing here touches a database.
 *
 * The expectations come from the application's real triggers, not from invention:
 *   - "Complete your team profile" (TeamProfileNudge): team roles whose card lacks a name, photo
 *     or description. Gone once all three exist. Never shown to readers.
 *   - The notification bell counts UNREAD notifications only; read ones are history.
 *   - "Your first published article" banner (FirstPublishBanner): writers/admins with an unseen
 *     first-publish achievement.
 *   - Drafts, submitted articles and the review queue come from article status and ownership.
 * Roles are never given prompts that belong to other roles (for example the administrator
 * overview is never shown to a persona).
 */
import type { TestPersona } from '@/lib/testingSessionConstants'

export const SCENARIO_TAG = 'testing-scenario'

export const SCENARIO_IDS = [
  'newly-registered',
  'no-linked-profile',
  'completed-profile',
  'writer-draft',
  'writer-submitted',
  'editor-queue',
  'unread-notifications',
  'dismissed-notifications',
  'first-publish',
  'restricted-access',
] as const
export type ScenarioId = (typeof SCENARIO_IDS)[number]

export const ALL_PERSONAS = ['writer', 'writer-other', 'editor', 'editor-global', 'growth'] as const satisfies readonly TestPersona[]
const WRITERS = ['writer', 'writer-other'] as const satisfies readonly TestPersona[]
const EDITORS = ['editor', 'editor-global'] as const satisfies readonly TestPersona[]

export interface Expectation {
  /** The prompt, element or page, as the person would describe it. */
  what: string
  /** True: it must be there. False: it must not be there. */
  shouldShow: boolean
  where: string
}

export interface ScenarioDefinition {
  id: ScenarioId
  label: string
  description: string
  personas: readonly TestPersona[]
  /** The things to check while signed in as the persona. */
  expectations: (persona: TestPersona) => Expectation[]
}

const PROFILE_PROMPT = 'The "Complete your team profile" prompt'
const FIRST_PUBLISH = 'The "first published article" banner'
const admin = (what: string): Expectation => ({ what, shouldShow: false, where: 'Dashboard' })

export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: 'newly-registered',
    label: 'Newly registered member',
    description: 'No Meet the Team profile, no notifications and no scenario content. The state right after an account is authorised.',
    personas: ALL_PERSONAS,
    expectations: () => [
      { what: PROFILE_PROMPT, shouldShow: true, where: 'Dashboard' },
      { what: 'Unread notification count on the bell', shouldShow: false, where: 'Dashboard header' },
      { what: FIRST_PUBLISH, shouldShow: false, where: 'Dashboard' },
      admin('The administrator overview'),
    ],
  },
  {
    id: 'no-linked-profile',
    label: 'Member with no linked public profile',
    description: 'Removes the persona’s Meet the Team profile (it is restored on reset), leaving everything else alone.',
    personas: ALL_PERSONAS,
    expectations: () => [
      { what: PROFILE_PROMPT, shouldShow: true, where: 'Dashboard' },
      { what: 'A profile form with no existing values, that creates a hidden card on first save', shouldShow: true, where: 'Team Profile' },
    ],
  },
  {
    id: 'completed-profile',
    label: 'Member with a completed profile',
    description: 'Name, photo and description are all present, so there is nothing left for the member to supply.',
    personas: ALL_PERSONAS,
    expectations: () => [
      { what: PROFILE_PROMPT, shouldShow: false, where: 'Dashboard' },
      { what: 'The saved description and photo, ready to edit', shouldShow: true, where: 'Team Profile' },
    ],
  },
  {
    id: 'writer-draft',
    label: 'Writer with a draft article',
    description: 'One draft in progress, owned by the writer.',
    personas: WRITERS,
    expectations: () => [
      { what: 'The draft in “My Drafts” and on the dashboard drafts list', shouldShow: true, where: 'Dashboard / My Drafts' },
      { what: 'The draft in the editor’s review queue', shouldShow: false, where: 'Review Queue (editors)' },
    ],
  },
  {
    id: 'writer-submitted',
    label: 'Writer with an article submitted for review',
    description: 'One article waiting for an editor, owned by the writer.',
    personas: WRITERS,
    expectations: () => [
      { what: 'The article with a “pending review” status, not editable as a draft', shouldShow: true, where: 'My Articles' },
      { what: 'Publish controls (only an editor can publish it)', shouldShow: false, where: 'The article' },
    ],
  },
  {
    id: 'editor-queue',
    label: 'Editor with articles awaiting review',
    description: 'Two articles in the Opinion category are waiting, written by the second writer.',
    personas: EDITORS,
    expectations: () => [
      { what: 'Both articles in the review queue and in the pending-review count', shouldShow: true, where: 'Review Queue / Dashboard' },
      { what: 'Controls to approve or reject them', shouldShow: true, where: 'Review Queue' },
    ],
  },
  {
    id: 'unread-notifications',
    label: 'Member with unread notifications',
    description: 'Three unread notifications. Replaces any scenario notifications already present.',
    personas: ALL_PERSONAS,
    expectations: () => [
      { what: 'A bell showing 3 unread, with the three messages listed', shouldShow: true, where: 'Dashboard header' },
    ],
  },
  {
    id: 'dismissed-notifications',
    label: 'Member with dismissed notifications',
    description: 'Three notifications that have already been read. Replaces any scenario notifications already present.',
    personas: ALL_PERSONAS,
    expectations: () => [
      { what: 'An unread count on the bell', shouldShow: false, where: 'Dashboard header' },
      { what: 'The three messages as already-read history', shouldShow: true, where: 'Notification list' },
    ],
  },
  {
    id: 'first-publish',
    label: 'Writer’s first published article',
    description: 'An unseen first-publish achievement, which shows a one-time banner until dismissed.',
    personas: WRITERS,
    expectations: () => [
      { what: FIRST_PUBLISH, shouldShow: true, where: 'Dashboard' },
      { what: 'The banner after it has been dismissed and the page reloaded', shouldShow: false, where: 'Dashboard' },
    ],
  },
  {
    id: 'restricted-access',
    label: 'Attempting restricted functionality',
    description: 'Changes no data. Use “Check access” to try administrator-only pages and APIs as this persona.',
    personas: ALL_PERSONAS,
    expectations: (persona) => [
      { what: 'Team Members, Users, Login Attempts, Data Management and Testing', shouldShow: false, where: 'The sidebar and by typing the address' },
      persona.startsWith('editor')
        ? { what: 'Unpublish, Delete and Restore on the Debates list', shouldShow: false, where: 'Debates' }
        : { what: 'Debates and the review queue', shouldShow: false, where: 'The sidebar and by typing the address' },
    ],
  },
]

export function scenarioById(id: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((s) => s.id === id)
}

export function scenariosFor(persona: TestPersona): ScenarioDefinition[] {
  return SCENARIOS.filter((s) => (s.personas as readonly string[]).includes(persona))
}
