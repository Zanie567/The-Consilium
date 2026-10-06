import Link from 'next/link'
import type { ProfileAssessment } from '@/lib/teamProfiles'

const MEMBER_LABEL = { name: 'your name', bio: 'a short description', photo: 'a photo' } as const
const BLOCKER_LABEL = {
  name: 'a name',
  bio: 'a description',
  position: 'a public title (an administrator sets this)',
  hidden: 'an administrator to make it visible',
} as const

function list(items: string[]) {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Plain-language state of the member's Meet the Team card, in the portal. */
export function TeamProfileStatus({ assessment }: { assessment: ProfileAssessment }) {
  const memberTodo = assessment.missingFromMember.map((key) => MEMBER_LABEL[key])
  const waiting = assessment.publicBlockers.map((key) => BLOCKER_LABEL[key])

  return (
    <section
      aria-label="Profile status"
      className="mt-6 border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-sm text-[var(--fg-muted)]"
    >
      <p className="font-bold text-[var(--fg)]">
        {assessment.publiclyVisible
          ? 'Your profile is live on the Our Team page.'
          : assessment.complete
            ? 'Profile complete'
            : 'Profile incomplete'}
      </p>
      {memberTodo.length > 0 && <p className="mt-1">Still to add: {list(memberTodo)}.</p>}
      {!assessment.publiclyVisible && (
        <p className="mt-1">Not on the public page yet. It needs {list(waiting)}.</p>
      )}
      <p className="mt-2 text-xs">
        <Link href="/team" className="underline hover:text-gold">See the public Our Team page</Link>
      </p>
    </section>
  )
}
