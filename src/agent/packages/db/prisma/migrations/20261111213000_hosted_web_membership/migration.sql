-- Recheck membership inside PostgreSQL as well as at the request boundary.
ALTER POLICY hosted_webs_owner ON hosted_webs USING (
 "spaceId"=NULLIF(current_setting('app.space_id',true),'') AND
 "userId"=NULLIF(current_setting('app.user_id',true),'') AND
 EXISTS(SELECT 1 FROM space_members m WHERE m."spaceId"=hosted_webs."spaceId" AND m."userId"=hosted_webs."userId")
);
ALTER POLICY hosted_web_revisions_owner ON hosted_web_revisions USING (
 "spaceId"=NULLIF(current_setting('app.space_id',true),'') AND
 "userId"=NULLIF(current_setting('app.user_id',true),'') AND
 EXISTS(SELECT 1 FROM space_members m WHERE m."spaceId"=hosted_web_revisions."spaceId" AND m."userId"=hosted_web_revisions."userId")
);
ALTER POLICY hosted_web_pins_owner ON hosted_web_pins USING (
 "spaceId"=NULLIF(current_setting('app.space_id',true),'') AND
 "userId"=NULLIF(current_setting('app.user_id',true),'') AND
 EXISTS(SELECT 1 FROM space_members m WHERE m."spaceId"=hosted_web_pins."spaceId" AND m."userId"=hosted_web_pins."userId")
);
