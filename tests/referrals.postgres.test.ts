import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createHash } from "node:crypto";
import postgres from "postgres";
import Fastify from "fastify";
import { MeshDatabase } from "../src/storage/database.js";
import { EconomicLedger } from "../src/economy/economic-ledger.js";
import { ContributionCreditWallet, contributionCreditSchemaSql } from "../src/economy/contribution-credit-wallet.js";
import { PromotionalCredits, expiringPromotionSchemaSql } from "../src/economy/promotional-credits.js";
import { Referrals, referralSchemaSql, referralAccessSchemaSql, type ReferralAccount } from "../src/economy/referrals.js";
import { mountReferralRoutes, referralReceipt, REFERRAL_COOKIE } from "../src/coordinator/referral-routes.js";
import { grantWelcomeCredits, WELCOME_CREDIT_MICROUNITS } from "../src/economy/welcome-credits.js";

// The dedicated CI gate supplies real PostgreSQL; ordinary unit discovery reports this suite skipped.
const url = process.env.MYCELLIOS_REFERRAL_TEST_POSTGRES_URL;
describe.skipIf(!url)("verified referrals on isolated PostgreSQL", () => {
const schema = "referrals_test_" + Math.random().toString(36).slice(2);
const runtimeRole = schema + "_native", deniedRole = schema + "_browser";
const sql = postgres(url!, { max: 2, onnotice: () => {} });
let db: MeshDatabase, ledger: EconomicLedger, wallet: ContributionCreditWallet, referrals: Referrals;
const now = 2_000_000_000_000;
const DAY = 86400000;
const person = (id: string): ReferralAccount => ({ userId: id, email: `${id}@example.test`, emailVerified: true });
async function account(id: string, createdAt = now + 1) {
  await db.raw.prepare("INSERT INTO api_accounts(user_id,created_at) VALUES (?,?)").run(id, createdAt);
  return person(id);
}
async function invitation(inviter = "inviter") {
  const owner = await account(inviter, now - 100);
  const invite = (await referrals.invite(owner, now))!;
  const receipt = (await referrals.visit(invite.code, undefined, now))!;
  return { owner, invite, receipt };
}
beforeAll(async () => {
  await sql.unsafe(`CREATE SCHEMA ${schema}`);
  const source = readFileSync(new URL("../src/storage/database.ts", import.meta.url), "utf8");
  // Reuse the canonical table definitions, preserving constraints and FK dependencies.
  const tables = ["economic_contribution_evidence", "economic_accounts", "pricing_policies", "economic_settlements",
    "economic_ledger_entries", "economic_settlement_receipts", "node_ownership", "economic_node_reputation"];
  for (const table of tables) {
    const ddl = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n      \\);`))?.[0];
    if (!ddl) throw new Error(`Canonical DDL missing: ${table}`);
    await sql.unsafe(`SET search_path TO ${schema}; ` + ddl.replace(/\bINTEGER\b/g, "BIGINT"));
  }
  await sql.unsafe(`SET search_path TO ${schema}; CREATE TABLE schema_meta(version integer); INSERT INTO schema_meta VALUES(33);
    CREATE TABLE api_usage(id text primary key,status text); CREATE TABLE api_accounts(user_id text primary key,created_at bigint);
    CREATE TABLE api_operator_funded_usage(usage_id text);` + contributionCreditSchemaSql + expiringPromotionSchemaSql + referralSchemaSql);
  await sql.unsafe(`CREATE ROLE ${runtimeRole} NOLOGIN; CREATE ROLE ${deniedRole} NOLOGIN;
    GRANT USAGE ON SCHEMA ${schema} TO ${runtimeRole},${deniedRole}; SET search_path TO ${schema};` + referralAccessSchemaSql(runtimeRole));
  db = await MeshDatabase.openPostgres(url!, schema);
  ledger = new EconomicLedger(db, { receiptSigning: { keyId: "referral-test", privateKey: generateKeyPairSync("ed25519").privateKey } });
  await ledger.registerDefaultInternalPricing();
  wallet = new ContributionCreditWallet(db, ledger, true);
  referrals = new Referrals(db, "isolated-test-pepper-never-production-123456");
  await wallet.initialize(); await referrals.initialize();
});
beforeEach(async () => {
  await db.raw.exec(`TRUNCATE referral_redemptions,referral_pending_accounts,referral_visits,referral_invites,economic_promotion_allocations,
    economic_credit_replays,economic_credit_transfers,api_contribution_funded_usage,economic_credit_holds,
    economic_promotional_grants,api_usage,api_accounts,economic_settlement_receipts,economic_ledger_entries,
    economic_settlements,economic_contribution_evidence,economic_accounts,economic_node_reputation CASCADE`);
});
afterAll(async () => { await db?.close(); await sql.unsafe(`DROP SCHEMA ${schema} CASCADE; DROP ROLE ${runtimeRole}; DROP ROLE ${deniedRole}`); await sql.end(); });

describe("default welcome credits",()=>{
  it("adds exactly 0.20 Credits / USD to a newly provisioned verified account",async()=>{
    const newcomer=await account("welcome-new");
    expect(WELCOME_CREDIT_MICROUNITS).toBe(200000);
    expect(await grantWelcomeCredits(db,newcomer,now+10)).toBe(true);
    expect(await wallet.summary("account",newcomer.userId,now+20)).toMatchObject({
      availableMicrounits:200000,promotionalGrantedMicrounits:200000,contributionEarnedMicrounits:0,reservedMicrounits:0,
    });
    expect(await db.raw.prepare("SELECT reason,expires_at FROM economic_promotional_grants WHERE account_id=?").get(newcomer.userId))
      .toMatchObject({reason:"verified-account-welcome",expires_at:null});
  });
  it("grants once under simultaneous login, refresh and lost-response retries",async()=>{
    const newcomer=await account("welcome-concurrent");
    const grants=await Promise.all(Array.from({length:20},()=>grantWelcomeCredits(db,newcomer,now+10)));
    expect(grants.filter(Boolean)).toHaveLength(1);
    expect(await grantWelcomeCredits(db,newcomer,now+DAY)).toBe(false);
    expect((await wallet.summary("account",newcomer.userId,now+DAY)).availableMicrounits).toBe(200000);
    expect((await wallet.summary("account","unrelated",now+DAY)).availableMicrounits).toBe(0);
    expect(await db.raw.prepare("SELECT COUNT(*) AS count FROM economic_promotional_grants WHERE account_id=?").get(newcomer.userId)).toMatchObject({count:1});
    expect(await db.raw.prepare("SELECT COUNT(*) AS count FROM economic_promotional_grants").get()).toMatchObject({count:1});
  });
  it("requires the verified provisioned identity and grants separately to each account",async()=>{
    const first=await account("welcome-first"),second=await account("welcome-second");
    expect(await grantWelcomeCredits(db,{...first,emailVerified:false},now)).toBe(false);
    expect(await grantWelcomeCredits(db,{userId:first.userId},now)).toBe(false);
    expect(await grantWelcomeCredits(db,{userId:"missing-account",emailVerified:true},now)).toBe(false);
    expect(await grantWelcomeCredits(db,{userId:"",emailVerified:true},now)).toBe(false);
    expect(await grantWelcomeCredits(db,first,now+10)).toBe(true);
    expect(await grantWelcomeCredits(db,second,now+10)).toBe(true);
    expect((await wallet.summary("account",first.userId,now+20)).availableMicrounits).toBe(200000);
    expect((await wallet.summary("account",second.userId,now+20)).availableMicrounits).toBe(200000);
  });
  it("preserves the separate referral reward without repeating either welcome grant",async()=>{
    const {owner,receipt}=await invitation();const newcomer=await account("welcome-referred");
    await grantWelcomeCredits(db,owner,now);await grantWelcomeCredits(db,newcomer,now+10);
    expect((await referrals.redeem(newcomer,receipt,now+20)).status).toBe("awarded");
    expect(await grantWelcomeCredits(db,newcomer,now+30)).toBe(false);
    expect((await wallet.summary("account",owner.userId,now+40)).availableMicrounits).toBe(1200000);
    expect((await wallet.summary("account",newcomer.userId,now+40)).availableMicrounits).toBe(1200000);
    expect((await wallet.summary("account",newcomer.userId,now+15*DAY)).availableMicrounits).toBe(200000);
  });
});

it("only the native database role can read or create invitations, even if browser table access is accidentally granted", async () => {
  await invitation();
  await sql.unsafe(`GRANT SELECT,INSERT ON ${schema}.referral_invites TO ${deniedRole}`);
  const rows = await sql.begin(async tx => { await tx.unsafe(`SET LOCAL ROLE ${deniedRole}`); return await tx.unsafe(`SELECT * FROM ${schema}.referral_invites`); });
  expect(rows).toHaveLength(0);
  await expect(sql.begin(async tx => { await tx.unsafe(`SET LOCAL ROLE ${deniedRole}`); await tx.unsafe(`INSERT INTO ${schema}.referral_invites VALUES('forged','forged','forged',0)`); })).rejects.toMatchObject({ code: "42501" });
  const allowed = await sql.begin(async tx => { await tx.unsafe(`SET LOCAL ROLE ${runtimeRole}`); return await tx.unsafe(`SELECT * FROM ${schema}.referral_invites`); });
  expect(allowed).toHaveLength(1);
});

it("keeps personal links stable and first touch across another invite, reload and verification", async () => {
  const { owner, invite, receipt } = await invitation();
  expect((await referrals.invite(owner, now + 10))?.code).toBe(invite.code);
  const second = await referrals.invite(await account("other", now - 1), now);
  expect(await referrals.visit(second!.code, receipt, now + 20)).toBe(receipt);
  const newcomer = await account("newcomer");
  expect(await referrals.redeem({ ...newcomer, emailVerified: false }, receipt, now + 30)).toEqual({ status: "verification_required" });
  expect(await referrals.redeem(newcomer, undefined, now + 40)).toMatchObject({ status: "awarded", rewardMicrounits: 1000000, expiresAt: now + 40 + 14 * DAY });
  expect((await wallet.summary("account", owner.userId, now + 50)).availableMicrounits).toBe(1000000);
  expect((await wallet.summary("account", "other", now + 50)).availableMicrounits).toBe(0);
  expect((await wallet.summary("account", "newcomer", now + 50)).availableMicrounits).toBe(1000000);
});

it("concurrent retries award both people exactly once, including a lost response", async () => {
  const { receipt } = await invitation(); const newcomer = await account("newcomer");
  const values = await Promise.all(Array.from({ length: 12 }, () => referrals.redeem(newcomer, receipt, now + 100)));
  expect(values.filter(v => v.status === "awarded")).toHaveLength(1);
  expect(values.filter(v => v.status === "already_awarded")).toHaveLength(11);
  expect(await db.raw.prepare("SELECT COUNT(*) AS count FROM economic_promotional_grants").get()).toMatchObject({ count: 2 });
  expect((await referrals.invite(person("inviter")))?.rewardedInvites).toBe(1);
});

it("cannot steal another account's pending invitation and keeps its original referrer", async () => {
  const { receipt } = await invitation();
  const newcomer = await account("newcomer");
  expect((await referrals.redeem({ ...newcomer, emailVerified: false }, receipt, now + 10)).status).toBe("verification_required");
  expect((await referrals.redeem(await account("thief"), receipt, now + 20)).status).toBe("not_eligible");
  const second = await referrals.invite(await account("other", now - 1), now);
  const laterReceipt = (await referrals.visit(second!.code, undefined, now))!;
  expect((await referrals.redeem(newcomer, laterReceipt, now + 30)).status).toBe("awarded");
  expect((await referrals.invite(person("inviter")))?.rewardedInvites).toBe(1);
  expect((await referrals.invite(person("other")))?.rewardedInvites).toBe(0);
});

it("rolls back BOTH grants on failure, then safely retries", async () => {
  const { receipt } = await invitation(); const newcomer = await account("newcomer");
  await db.raw.exec(`ALTER TABLE referral_redemptions ADD CONSTRAINT injected_failure CHECK(account_id <> 'newcomer')`);
  try { await expect(referrals.redeem(newcomer, receipt, now + 100)).rejects.toThrow(); }
  finally { await db.raw.exec("ALTER TABLE referral_redemptions DROP CONSTRAINT injected_failure"); }
  expect(await db.raw.prepare("SELECT COUNT(*) AS count FROM economic_promotional_grants").get()).toMatchObject({ count: 0 });
  expect((await referrals.redeem(newcomer, receipt, now + 200)).status).toBe("awarded");
});

it("cannot issue either reward while release qualification is closed", async () => {
  const { receipt } = await invitation(); const newcomer = await account("newcomer");
  await db.raw.exec(`CREATE TABLE jobs(id text); CREATE FUNCTION test_release_guard() RETURNS trigger LANGUAGE plpgsql AS $test$ BEGIN RETURN NULL; END; $test$;
    CREATE TRIGGER mycellios_release_admission_guard BEFORE INSERT ON jobs FOR EACH STATEMENT EXECUTE FUNCTION test_release_guard()`);
  try {
    await expect(referrals.redeem(newcomer, receipt, now + 100)).rejects.toMatchObject({ code: "55000" });
    expect(await db.raw.prepare("SELECT COUNT(*) AS count FROM economic_promotional_grants").get()).toMatchObject({ count: 0 });
  } finally { await db.raw.exec("DROP TABLE jobs; DROP FUNCTION test_release_guard()"); }
  expect((await referrals.redeem(newcomer, receipt, now + 200)).status).toBe("awarded");
});

it("rejects self referral, reused verified email, old accounts, expired and forged receipts", async () => {
  const { owner, invite, receipt } = await invitation();
  expect((await referrals.redeem(owner, receipt, now + 20)).status).toBe("not_eligible");
  const old = await account("old", now - 1);
  expect((await referrals.redeem(old, receipt, now + 20)).status).toBe("not_eligible");
  const newcomer = await account("newcomer");
  expect((await referrals.redeem({ ...newcomer, email: "INVITER@example.test" }, receipt, now + 20)).status).toBe("not_eligible");
  expect((await referrals.redeem(newcomer, "x".repeat(43), now + 20)).status).toBe("not_eligible");
  expect((await referrals.redeem(newcomer, receipt, now + 31 * DAY)).status).toBe("not_eligible");
  expect((await referrals.redeem(newcomer, receipt, now + 20)).status).toBe("awarded");
  const anotherReceipt = (await referrals.visit(invite.code, undefined, now))!;
  const duplicate = await account("duplicate");
  expect((await referrals.redeem({ ...duplicate, email: newcomer.email }, anotherReceipt, now + 30)).status).toBe("not_eligible");
  expect((await referrals.redeem(duplicate, receipt, now + 30)).status).toBe("not_eligible");
});

it("expires unspent rewards without touching permanent credits and balances the platform", async () => {
  const { receipt } = await invitation(); const newcomer = await account("newcomer");
  await referrals.redeem(newcomer, receipt, now + 20);
  await db.raw.prepare("INSERT INTO economic_promotional_grants VALUES(?,?,?,?,?,?,?)").run("legacy", "newcomer", "test", "legacy", 123, now, null);
  expect((await wallet.summary("account", "newcomer", now + 15 * DAY)).availableMicrounits).toBe(123);
  expect((await wallet.summary("account", "newcomer", now + 15 * DAY)).promotionalExpiredMicrounits).toBe(1000000);
  const campaignDisabled = new ContributionCreditWallet(db, ledger, false);
  await campaignDisabled.initialize();
  expect((await campaignDisabled.summary("account", "newcomer", now + 15 * DAY)).availableMicrounits).toBe(123);
  const total = (await wallet.summary("account", "inviter", now + 15 * DAY)).balanceMicrounits
    + (await wallet.summary("account", "newcomer", now + 15 * DAY)).balanceMicrounits
    + (await wallet.summary("platform", "platform", now + 15 * DAY)).balanceMicrounits;
  expect(total).toBe(0);
});

it("reserves expiring funds first, protects in-flight work and releases unused expired funds", async () => {
  const realNow = Date.now();
  const { receipt } = await invitation(); await referrals.redeem(await account("newcomer"), receipt, now + 20);
  await db.raw.prepare("UPDATE economic_promotional_grants SET expires_at=?").run(realNow + DAY);
  await db.raw.prepare("INSERT INTO api_usage VALUES(?,'pending')").run("hold");
  await wallet.reserve("hold", "newcomer", { model: "test-model", messages: [], max_tokens: 100 });
  expect(await db.raw.prepare("SELECT reserved_microunits FROM economic_promotion_allocations WHERE hold_id='hold'").get()).toMatchObject({ reserved_microunits: 402 });
  expect((await wallet.summary("account", "newcomer", realNow + 2 * DAY)).availableMicrounits).toBe(0);
  expect((await wallet.summary("account", "newcomer", realNow + 2 * DAY)).balanceMicrounits).toBe(402);
  await wallet.release("hold");
  expect((await wallet.summary("account", "newcomer", realNow + 2 * DAY)).balanceMicrounits).toBe(0);
});

it("settles actual usage through the signed ledger after reward expiry, without negative credit", async () => {
  const realNow = Date.now();
  const { receipt } = await invitation(); await referrals.redeem(await account("newcomer"), receipt, now + 20);
  await db.raw.prepare("UPDATE economic_promotional_grants SET expires_at=?").run(realNow + DAY);
  await db.raw.prepare("INSERT INTO api_usage VALUES(?,'pending')").run("hold");
  await wallet.reserve("hold", "newcomer", { model: "test-model", messages: [], max_tokens: 100 });
  await wallet.attach("hold", "test-job");
  // Expire while this hold remains active. Fixture evidence exercises accounting, not physical inference.
  await db.raw.prepare("UPDATE economic_promotional_grants SET expires_at=?").run(realNow - 1);
  const digest = "sha256:" + createHash("sha256").update("fixture").digest("hex");
  const evidence = { schema: "mycellios-physical-contribution-evidence/1", id: digest, jobId: "test-job", executionReceiptId: digest,
    traceDigest: digest, participants: [{ nodeId: "test-node", workerId: "test-worker", physicalIdentityDigest: digest,
      canaryEvidenceIds: [digest], stageCount: 1 }], physicalBoundaryCount: 0, observedFrom: realNow - 100, observedUntil: realNow, createdAt: realNow };
  await db.raw.prepare("INSERT INTO economic_contribution_evidence VALUES(?,?,?,?,?,?)").run(digest, "test-job", digest, digest, JSON.stringify(evidence), realNow);
  const policy = (await ledger.resolvePricingPolicy("test-model", "remote-replica", realNow))!;
  const input = { jobId: "test-job", executionReceiptId: digest, contributionEvidenceId: digest, pricingPolicyId: policy.id,
    executionRecovery: { mode: "none" as const, attempts: 1, replayedTokenEvents: 0 },
    payerAccountId: "newcomer", inputTokens: 10, outputTokens: 5, contributors: [{ nodeId: "test-node", weight: 1 }], createdAt: realNow };
  const result = await wallet.settle(input);
  expect(result.grossMicrounits).toBe(30);
  expect((await wallet.summary("account", "newcomer")).availableMicrounits).toBe(0);
  expect((await wallet.summary("account", "newcomer")).promotionalExpiredMicrounits).toBe(999970);
  expect(await wallet.settle(input)).toEqual(result);
  expect(await db.raw.prepare("SELECT SUM(amount_microunits) AS total FROM economic_ledger_entries").get()).toMatchObject({ total: 0 });
});

it("serves a fixed signup redirect with an opaque HttpOnly cookie and refuses anonymous awards", async () => {
  const { invite, receipt } = await invitation();
  const app = Fastify(); mountReferralRoutes(app, { service: referrals, publicOrigin: "https://www.mycellios.com/v1", account: () => null });
  try {
    const response = await app.inject({ method: "GET", url: `/v1/referrals/visit/${invite.code}`, headers: { cookie: `${REFERRAL_COOKIE}=${receipt}` } });
    expect(response.statusCode).toBe(302); expect(response.headers.location).toBe("https://www.mycellios.com/agent/sign-up");
    expect(response.headers["set-cookie"]).toBe(`${REFERRAL_COOKIE}=${receipt}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`);
    expect((await app.inject({ method: "POST", url: "/v1/referrals/redeem", payload: { accountId: "forged", amount: 9000000 } })).statusCode).toBe(403);
    expect(referralReceipt(`${REFERRAL_COOKIE}=${receipt}; ${REFERRAL_COOKIE}=${receipt}`)).toBeUndefined();
  } finally { await app.close(); }
});
});
