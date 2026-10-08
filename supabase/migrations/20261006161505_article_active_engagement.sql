BEGIN;
CREATE TABLE IF NOT EXISTS article_engagement_sessions (
 id text PRIMARY KEY,
 "articleId" text NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
 "startedAt" timestamptz(3) NOT NULL DEFAULT now(),
 "lastSeenAt" timestamptz(3) NOT NULL DEFAULT now(),
 "activeSeconds" integer NOT NULL DEFAULT 0 CHECK ("activeSeconds" BETWEEN 0 AND 7200),
 "engagedAt" timestamptz(3),
 "readerHash" text,
 "returning" boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS "article_engagement_sessions_articleId_startedAt_idx" ON article_engagement_sessions("articleId", "startedAt");
CREATE INDEX IF NOT EXISTS "article_engagement_sessions_startedAt_idx" ON article_engagement_sessions("startedAt");
CREATE INDEX IF NOT EXISTS "article_engagement_sessions_readerHash_startedAt_idx" ON article_engagement_sessions("readerHash", "startedAt");
ALTER TABLE article_engagement_sessions DROP CONSTRAINT IF EXISTS "article_engagement_sessions_activeSeconds_check";
ALTER TABLE article_engagement_sessions ADD CONSTRAINT "article_engagement_sessions_activeSeconds_check" CHECK ("activeSeconds" BETWEEN 0 AND 7200);
ALTER TABLE article_engagement_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON article_engagement_sessions FROM PUBLIC;
COMMIT;
