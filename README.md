# The Consilium

The official student publication of the University of Edinburgh Economics Society. Built with Next.js 16 (App Router), Prisma, Supabase, and NextAuth.js.

---

## What is this?

The Consilium is a student-run economics publication. This repository contains the full web application: public-facing articles, an editorial portal for writers and editors, a comment system, newsletter subscriptions, and an admin dashboard.

---

## Running locally

### Prerequisites

- Node.js 20+
- A Supabase project (for the database)
- A Resend account (for email)
- Optionally: FRED and Alpha Vantage API keys (for the economic ticker)

### Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/Zanie567/The-Consilium.git
   cd The-Consilium
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment variables**

   Copy `.env.example` to `.env.local` and fill in your values:

   ```bash
   cp .env.example .env.local
   ```

   Key variables:
   - `DATABASE_URL` — Supabase PostgreSQL connection string (use the Transaction pooler URL)
   - `NEXTAUTH_SECRET` — random secret, generate with `openssl rand -base64 32`
   - `NEXTAUTH_URL` — `http://localhost:3000` for local dev
   - `NEXT_PUBLIC_SITE_URL` — same as `NEXTAUTH_URL` for local dev
   - `RESEND_API_KEY` — from [resend.com](https://resend.com)
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from your Supabase project settings

4. **Run the development server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

---

## Creating a new article

Articles are created through the editorial portal at `/editorial/articles/new`. You must be signed in as a **Writer**, **Editor**, or **Admin**.

1. Sign in at `/editorial/login`
2. Navigate to **New Article**
3. Write your article in the rich-text editor (TipTap)
4. Submit for review — Editors receive an email notification
5. An Editor reviews and either publishes or returns the article with feedback

---

## Role system

| Role | Permissions |
|------|------------|
| `READER` | Read articles, comment, bookmark |
| `WRITER` | Submit articles for editorial review |
| `EDITOR` | Review and publish articles, manage writers, moderate comments |
| `GROWTH` | Access to growth/subscriber analytics |
| `ADMIN` | Full access including user management and audit log |

The first user whose email is listed in `ADMIN_EMAILS` (env var) is automatically granted Admin on first login.

Role changes take effect on the user's next sign-in.

---

## Branch naming conventions

- `main` — production. **Never push directly.**
- `claude/<description>` — branches created by Claude Code
- `codex/<description>` — branches created by Codex
- Feature branches should be short-lived and merged via PR.

---

## Database

> **Critical rule: never run `prisma migrate dev` or `prisma db push` against the production database.**

The schema is defined in `prisma/schema.prisma`. To update the schema:

1. Modify `prisma/schema.prisma`
2. Run `npm run db:generate` to regenerate the Prisma client
3. Write a migration SQL file manually and apply it to Supabase through the dashboard

Prisma Studio is available locally: `npm run db:studio`

---

## Deployment

The site is deployed to Vercel. Pushes to `main` trigger a production deployment automatically.

To deploy manually:
1. Push your branch to GitHub
2. Open a PR to `main`
3. Merge after CI passes and at least one review

Environment variables must be set in the Vercel project dashboard — they are **not** automatically synced from `.env.local`.

---

## Available scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the development server |
| `npm run build` | Build for production |
| `npm run start` | Start the production server |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier (auto-fix) |
| `npm run typecheck` | Run TypeScript type-checking without emitting |
| `npm run db:generate` | Regenerate the Prisma client after schema changes |
| `npm run db:studio` | Open Prisma Studio |

---

## Tech stack

- **Framework**: Next.js 16 (App Router)
- **Database**: PostgreSQL via Supabase, accessed with Prisma
- **Auth**: NextAuth.js v4 with Prisma adapter
- **Rich text editor**: TipTap 3
- **Email**: Resend
- **File uploads**: UploadThing + Supabase Storage
- **Styling**: Tailwind CSS v4
- **Animations**: Framer Motion
- **Charts**: Chart.js + react-chartjs-2
