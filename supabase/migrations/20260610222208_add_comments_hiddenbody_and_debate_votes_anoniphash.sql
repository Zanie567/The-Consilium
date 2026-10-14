-- Recorded in production on 2026-06-10 via the Supabase API (this exact SQL, from the registry).
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "hiddenBody" text;
ALTER TABLE "debate_votes" ADD COLUMN IF NOT EXISTS "anonIpHash" text;
CREATE UNIQUE INDEX IF NOT EXISTS "debate_votes_debateId_anonIpHash_key" ON "debate_votes"("debateId", "anonIpHash");
