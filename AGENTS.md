<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes. APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Vercel previews cost Hobby storage

Every push to a branch can build a Vercel preview, and each retained preview stores ~30 MB of
functions against the Hobby plan's 10 GB (docs/operations/vercel-hobby-resources.md).
`scripts/vercel-ignore-build.mjs` already skips previews whose changes are only tests, docs, CI
or SQL. Beyond that: batch fixes into fewer pushes, and put `[skip preview]` in the commit
message while iterating on a branch that does not need a hosted preview yet (`[preview]` forces
one). The tokens work anywhere in the message, like `[skip ci]`, so do not quote them in a
commit message you want previewed. Production deployments from `main` are never skipped.
