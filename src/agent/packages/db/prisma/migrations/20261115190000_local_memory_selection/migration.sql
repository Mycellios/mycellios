-- Self-contained task identity: do not depend on unpublished message-pin migrations.
CREATE UNIQUE INDEX memory_thread_identity_scope_key ON threads(id,"spaceId","userId");
ALTER TABLE memory_documents ADD COLUMN inclusion TEXT NOT NULL DEFAULT 'searchable',
 ADD COLUMN "userControlled" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "taskThreadId" TEXT;
ALTER TABLE memory_documents ADD CONSTRAINT memory_inclusion_valid CHECK(inclusion IN ('essential','searchable')),
 ADD CONSTRAINT memory_task_bot CHECK("taskThreadId" IS NULL OR (scope='bot' AND "botId" IS NOT NULL)),
 ADD CONSTRAINT memory_task_owner FOREIGN KEY ("taskThreadId","spaceId","userId") REFERENCES threads(id,"spaceId","userId") ON DELETE CASCADE;
CREATE INDEX memory_task_scope ON memory_documents("spaceId","userId","botId","taskThreadId");
-- Keep existing small index notes in every turn; leave all contents/revisions intact.
UPDATE memory_documents SET inclusion='essential' WHERE path='MEMORY.md' AND octet_length(content)<=7000;
CREATE TABLE local_memory_reviews (
 id TEXT PRIMARY KEY, "threadId" TEXT NOT NULL, "botId" TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
 "spaceId" TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 generation INTEGER NOT NULL, "lastSeq" INTEGER NOT NULL, status TEXT NOT NULL,
 "maximumMicrounits" INTEGER NOT NULL DEFAULT 0 CHECK("maximumMicrounits">=0),
 "chargedMicrounits" INTEGER CHECK("chargedMicrounits">=0 AND "chargedMicrounits"<="maximumMicrounits"),
 "idempotencyKey" TEXT NOT NULL UNIQUE, "connectionDigest" TEXT NOT NULL, result JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("threadId","spaceId","userId") REFERENCES threads(id,"spaceId","userId") ON DELETE CASCADE,
 UNIQUE("threadId",generation,"lastSeq"),
 CHECK(status IN ('reserved','submitted','pending','ready','completed','failed'))
);
CREATE INDEX review_daily_budget ON local_memory_reviews("userId","spaceId","createdAt");
ALTER TABLE local_memory_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_memory_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_review_owner ON local_memory_reviews USING (
 "spaceId"=NULLIF(current_setting('app.space_id',true),'') AND "userId"=NULLIF(current_setting('app.user_id',true),'')
 AND EXISTS(SELECT 1 FROM space_members m WHERE m."spaceId"=local_memory_reviews."spaceId" AND m."userId"=local_memory_reviews."userId")
);
CREATE POLICY memory_review_system ON local_memory_reviews USING(current_setting('app.rls_bypass',true)='on');
