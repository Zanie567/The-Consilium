/**
 * Applies and resets the deterministic scenarios in testingScenarioCatalog.ts.
 *
 * Safety, in order of importance:
 *  1. Every entry point first calls `requireTestingWorkspace()`, which throws unless the
 *     environment is a verified isolated workspace AND the database carries that workspace's
 *     marker. There is no override and no "dry run against production" path.
 *  2. Only the five persona accounts (`testPersonaKey` set) are ever touched. A request naming
 *     any other account cannot reach this code: the persona is resolved from the allow-list.
 *  3. Rows this module creates are tagged (`testing-scenario`) and are the only rows it ever
 *     deletes. Persona data that already existed (their Meet the Team profile) is snapshotted
 *     before the first change and restored exactly on reset.
 *  4. Everything for one persona runs in one transaction under an advisory lock, so two clicks
 *     cannot interleave and a failure leaves the persona exactly as it was.
 *
 * Applying a scenario twice gives the same state as applying it once.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ACHIEVEMENT_TYPES } from '@/lib/constants'
import { defaultPublicAppointment } from '@/lib/teamProfiles'
import { TEST_PERSONAS, requireTestingWorkspace, type TestPersona } from '@/lib/testingMode'
import { SCENARIO_TAG, scenarioById, type ScenarioId } from '@/lib/testingScenarioCatalog'

type Tx = Prisma.TransactionClient

export class ScenarioError extends Error {
  constructor(readonly code: 'UNKNOWN_SCENARIO' | 'UNKNOWN_PERSONA' | 'NOT_APPLICABLE' | 'PERSONA_MISSING', message: string, readonly status: number) {
    super(message)
  }
}

const snapshotKey = (userId: string) => `testing-scenario-snapshot:${userId}`
const SAMPLE_PHOTO = '/team/sam-hunt.png'
const SAMPLE_CONTENT = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Scenario article body.' }] }] })

interface CardSnapshot {
  card: {
    id: string; userId: string | null; name: string; role: string; publicTier: string | null; bio: string | null
    image: string | null; email: string | null; order: number; isActive: boolean
  } | null
}

async function personaUser(tx: Tx, persona: TestPersona) {
  if (!(TEST_PERSONAS as readonly string[]).includes(persona)) throw new ScenarioError('UNKNOWN_PERSONA', 'Choose one of the test personas.', 400)
  const user = await tx.user.findUnique({ where: { testPersonaKey: persona }, select: { id: true, name: true, email: true, role: true } })
  if (!user) throw new ScenarioError('PERSONA_MISSING', 'That test persona does not exist in this workspace. Run the testing seed first.', 503)
  return user
}

type Persona = Awaited<ReturnType<typeof personaUser>>

/** Remember the persona's profile exactly once, before the first scenario changes it. */
async function snapshotCard(tx: Tx, user: Persona) {
  const existing = await tx.siteSetting.findUnique({ where: { key: snapshotKey(user.id) } })
  if (existing) return
  const card = await tx.teamMember.findUnique({ where: { userId: user.id } })
  const value: CardSnapshot = { card }
  await tx.siteSetting.create({ data: { key: snapshotKey(user.id), value: JSON.stringify(value) } })
}

async function restoreCard(tx: Tx, user: Persona) {
  const row = await tx.siteSetting.findUnique({ where: { key: snapshotKey(user.id) } })
  if (!row?.value) return
  const { card }: CardSnapshot = JSON.parse(row.value)
  await tx.teamMember.deleteMany({ where: { userId: user.id } })
  if (card) {
    const { id, ...data } = card
    await tx.teamMember.create({ data: { id, ...data, userId: user.id } })
  }
  await tx.siteSetting.delete({ where: { key: snapshotKey(user.id) } })
}

async function clearNotifications(tx: Tx, user: Persona) {
  await tx.notification.deleteMany({ where: { userId: user.id, type: SCENARIO_TAG } })
}

async function addNotifications(tx: Tx, user: Persona, read: boolean) {
  await clearNotifications(tx, user)
  for (const n of [1, 2, 3]) {
    await tx.notification.create({
      data: {
        userId: user.id,
        type: SCENARIO_TAG,
        title: `[Scenario] Notification ${n}`,
        message: `Scenario notification ${n} (${read ? 'already read' : 'unread'}).`,
        read,
        // Stable order: 1 is newest.
        createdAt: new Date(Date.now() - n * 60_000),
      },
    })
  }
}

/**
 * Every scenario article's slug names its OWNER: the persona the scenario was applied to (not necessarily its author).
 * That is the whole ownership rule: resetting a persona removes exactly the articles that carry its owner tag, so
 * resetting the writer who authored an editor's review queue cannot delete that queue, and vice versa.
 */
const ownerTag = (userId: string) => userId.slice(-8)
const articleSlug = (kind: string, userId: string, n = 1) => `${SCENARIO_TAG}-${kind}-${ownerTag(userId)}-${n}`
/** Slug prefixes a persona can own. Only editors own a review queue; for anyone else a `queue` slug carrying their tag is a pre-owner-tag row authored by them. */
const ownedSlugs = (user: { id: string; role: string }): Prisma.ArticleWhereInput[] =>
  [...(user.role === 'EDITOR' ? ['queue'] : []), 'draft', 'submitted'].map((kind) => ({ slug: { startsWith: `${SCENARIO_TAG}-${kind}-${ownerTag(user.id)}-` } }))

async function opinionCategoryId(tx: Tx): Promise<string | null> {
  const opinion = await tx.category.findFirst({ where: { slug: 'opinion' }, select: { id: true } })
  return (opinion ?? (await tx.category.findFirst({ select: { id: true }, orderBy: { name: 'asc' } })))?.id ?? null
}

async function upsertArticle(tx: Tx, data: { slug: string; title: string; authorId: string; status: 'DRAFT' | 'PENDING_REVIEW'; categoryId: string | null }) {
  await deleteScenarioArticles(tx, { slug: data.slug })
  await tx.article.create({
    data: { ...data, content: SAMPLE_CONTENT, excerpt: 'Created by a testing scenario.', publishedAt: null },
  })
}

/**
 * Deletes scenario articles AND the notifications that point at them, for every account. Notification.articleId is
 * ON DELETE SET NULL, so deleting only the article would leave "an article was submitted" notifications behind in other
 * personas' bells that open nothing. Returns how many articles were removed.
 */
async function deleteScenarioArticles(tx: Tx, where: Prisma.ArticleWhereInput): Promise<number> {
  const ids = (await tx.article.findMany({ where, select: { id: true } })).map((a) => a.id)
  if (ids.length === 0) return 0
  await tx.notification.deleteMany({ where: { articleId: { in: ids } } })
  await tx.article.deleteMany({ where: { id: { in: ids } } })
  return ids.length
}

/** Everything a scenario created FOR this persona (by owner tag), and nothing else. Idempotent. */
async function clearScenarioContent(tx: Tx, user: Persona) {
  await clearNotifications(tx, user)
  await tx.writerAchievement.deleteMany({ where: { userId: user.id, referenceId: SCENARIO_TAG } })
  await deleteScenarioArticles(tx, {
    OR: ownedSlugs(user),
    // Only rows a scenario made: authored by a test persona. A real article can never carry this slug prefix by accident.
    author: { testPersonaKey: { not: null } },
  })
}

async function lock(tx: Tx, user: Persona) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`testing-scenarios:${user.id}`}))`
}

export async function applyScenario(personaKey: TestPersona, scenarioId: ScenarioId | string, client: typeof prisma = prisma): Promise<{ scenario: ScenarioId }> {
  await requireTestingWorkspace()
  const scenario = scenarioById(scenarioId)
  if (!scenario) throw new ScenarioError('UNKNOWN_SCENARIO', 'Unknown scenario.', 400)
  if (!(scenario.personas as readonly string[]).includes(personaKey)) {
    throw new ScenarioError('NOT_APPLICABLE', `“${scenario.label}” does not apply to this persona.`, 400)
  }

  await client.$transaction(async (tx) => {
    const user = await personaUser(tx, personaKey)
    await lock(tx, user)

    switch (scenario.id) {
      case 'newly-registered': {
        await clearScenarioContent(tx, user)
        await snapshotCard(tx, user)
        await tx.teamMember.deleteMany({ where: { userId: user.id } })
        break
      }
      case 'no-linked-profile': {
        await snapshotCard(tx, user)
        await tx.teamMember.deleteMany({ where: { userId: user.id } })
        break
      }
      case 'completed-profile': {
        await snapshotCard(tx, user)
        const card = await tx.teamMember.findUnique({ where: { userId: user.id } })
        const appointment = defaultPublicAppointment(user.role)
        const bio = 'A complete profile written by a testing scenario.'
        if (card) {
          await tx.teamMember.update({ where: { id: card.id }, data: { bio, image: card.image || SAMPLE_PHOTO, name: card.name || user.name || user.email } })
        } else {
          await tx.teamMember.create({
            data: {
              userId: user.id,
              name: user.name || user.email,
              role: appointment?.role ?? '',
              publicTier: appointment?.publicTier ?? null,
              bio,
              image: SAMPLE_PHOTO,
              order: 1000,
              isActive: false,
            },
          })
        }
        break
      }
      case 'writer-draft': {
        await upsertArticle(tx, { slug: articleSlug('draft', user.id), title: '[Scenario] Draft in progress', authorId: user.id, status: 'DRAFT', categoryId: null })
        break
      }
      case 'writer-submitted': {
        await upsertArticle(tx, { slug: articleSlug('submitted', user.id), title: '[Scenario] Submitted for review', authorId: user.id, status: 'PENDING_REVIEW', categoryId: await opinionCategoryId(tx) })
        break
      }
      case 'editor-queue': {
        // Written by the second writer so the editor is reviewing someone else's work, but OWNED by this editor (see ownerTag).
        const author = (await tx.user.findUnique({ where: { testPersonaKey: 'writer-other' }, select: { id: true, name: true, email: true, role: true } })) ?? (await personaUser(tx, 'writer'))
        const categoryId = await opinionCategoryId(tx)
        for (const n of [1, 2]) {
          await upsertArticle(tx, { slug: articleSlug('queue', user.id, n), title: `[Scenario] Awaiting review ${n}`, authorId: author.id, status: 'PENDING_REVIEW', categoryId })
        }
        break
      }
      case 'unread-notifications': await addNotifications(tx, user, false); break
      case 'dismissed-notifications': await addNotifications(tx, user, true); break
      case 'first-publish': {
        await tx.writerAchievement.deleteMany({ where: { userId: user.id, referenceId: SCENARIO_TAG } })
        await tx.writerAchievement.create({ data: { userId: user.id, type: ACHIEVEMENT_TYPES.FIRST_PUBLISH, referenceId: SCENARIO_TAG, seenAt: null } })
        break
      }
      case 'restricted-access':
        break // no data: the check is made from the browser
    }
  })
  return { scenario: scenario.id }
}

/** Puts one persona (or all of them) back exactly as they were before any scenario. */
export async function resetScenarios(personaKey?: TestPersona, client: typeof prisma = prisma): Promise<{ personas: TestPersona[] }> {
  await requireTestingWorkspace()
  const keys = personaKey ? [personaKey] : [...TEST_PERSONAS]
  const done: TestPersona[] = []
  for (const key of keys) {
    await client.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { testPersonaKey: key }, select: { id: true, name: true, email: true, role: true } })
      if (!user) return
      await lock(tx, user)
      await clearScenarioContent(tx, user)
      await restoreCard(tx, user)
      done.push(key)
    })
  }
  // Review-queue rows created before owner tags existed carry their AUTHOR's tag, so no persona owns them. They can only
  // have come from an editor scenario: remove them when an editor (or everyone) is reset, never when a writer is.
  const editorsReset = !personaKey || personaKey.startsWith('editor')
  if (editorsReset) {
    await client.$transaction(async (tx) => {
      const authors = await tx.user.findMany({ where: { testPersonaKey: { not: null } }, select: { id: true } })
      const ownedByAnEditor = (await tx.user.findMany({ where: { testPersonaKey: { startsWith: 'editor' } }, select: { id: true } })).map((u) => ownerTag(u.id))
      const legacy = await tx.article.findMany({
        where: { slug: { startsWith: `${SCENARIO_TAG}-queue-` }, authorId: { in: authors.map((a) => a.id) } },
        select: { id: true, slug: true },
      })
      const orphaned = legacy.filter((a) => !ownedByAnEditor.some((t) => a.slug.includes(`-queue-${t}-`)))
      if (orphaned.length) await deleteScenarioArticles(tx, { id: { in: orphaned.map((a) => a.id) } })
    })
  }
  return { personas: done }
}

export interface ScenarioState {
  profile: 'untouched' | 'removed' | 'completed'
  draft: boolean
  submitted: boolean
  queue: boolean
  notifications: 'none' | 'unread' | 'read'
  firstPublish: boolean
}

/** What is currently applied to a persona, for the Testing screen. Read-only. */
export async function scenarioState(personaKey: TestPersona, client: typeof prisma = prisma): Promise<ScenarioState | null> {
  await requireTestingWorkspace()
  const user = await client.user.findUnique({ where: { testPersonaKey: personaKey }, select: { id: true } })
  if (!user) return null
  const [snapshot, card, draft, submitted, queue, unread, read, first] = await Promise.all([
    client.siteSetting.findUnique({ where: { key: snapshotKey(user.id) } }),
    client.teamMember.findUnique({ where: { userId: user.id }, select: { id: true, bio: true } }),
    client.article.count({ where: { slug: articleSlug('draft', user.id) } }),
    client.article.count({ where: { slug: articleSlug('submitted', user.id) } }),
    client.article.count({ where: { slug: { startsWith: `${SCENARIO_TAG}-queue-${ownerTag(user.id)}-` } } }),
    client.notification.count({ where: { userId: user.id, type: SCENARIO_TAG, read: false } }),
    client.notification.count({ where: { userId: user.id, type: SCENARIO_TAG, read: true } }),
    client.writerAchievement.count({ where: { userId: user.id, referenceId: SCENARIO_TAG } }),
  ])
  return {
    profile: !snapshot ? 'untouched' : card ? 'completed' : 'removed',
    draft: draft > 0,
    submitted: submitted > 0,
    queue: queue > 0,
    notifications: unread > 0 ? 'unread' : read > 0 ? 'read' : 'none',
    firstPublish: first > 0,
  }
}
