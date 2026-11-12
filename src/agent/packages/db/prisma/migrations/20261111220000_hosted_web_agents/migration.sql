CREATE TABLE hosted_web_agents (
 "siteId" TEXT PRIMARY KEY,
 "spaceId" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "botId" TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
 "threadId" TEXT NOT NULL UNIQUE REFERENCES threads(id) ON DELETE CASCADE,
 UNIQUE ("siteId","userId","spaceId"),
 FOREIGN KEY ("siteId","userId","spaceId") REFERENCES hosted_webs(id,"userId","spaceId") ON DELETE CASCADE
);
ALTER TABLE hosted_web_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY hosted_web_agents_owner ON hosted_web_agents USING (
 "spaceId"=NULLIF(current_setting('app.space_id',true),'') AND
 "userId"=NULLIF(current_setting('app.user_id',true),'') AND
 EXISTS(SELECT 1 FROM space_members m WHERE m."spaceId"=hosted_web_agents."spaceId" AND m."userId"=hosted_web_agents."userId")
);
CREATE POLICY hosted_web_agents_system ON hosted_web_agents USING (current_setting('app.rls_bypass',true)='on');
