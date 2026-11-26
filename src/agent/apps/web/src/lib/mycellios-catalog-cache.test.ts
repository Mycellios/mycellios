// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { readCachedMycelliosCatalog, writeCachedMycelliosCatalog } from "./mycellios-catalog-cache";

const entry = { provider: "openai-compatible", id: "mycellios/managed/antseed/x", label: "X", billing: "credits" };
const scope = ["user", "space", "connection"] as const;

beforeEach(() => localStorage.clear());

it("returns the last catalog for the same account, Space and connection only", () => {
  writeCachedMycelliosCatalog(scope, [entry], 1_000);
  expect(readCachedMycelliosCatalog(scope, 2_000)).toEqual([entry]);
  expect(readCachedMycelliosCatalog(["user", "other", "connection"], 2_000)).toBeUndefined();
  expect(readCachedMycelliosCatalog(["user", undefined, "connection"], 2_000)).toBeUndefined();
});

it("drops stale, empty or malformed copies", () => {
  writeCachedMycelliosCatalog(scope, [entry], 0);
  expect(readCachedMycelliosCatalog(scope, 24 * 60 * 60_000 + 1)).toBeUndefined();
  writeCachedMycelliosCatalog(scope, [], 0);
  expect(readCachedMycelliosCatalog(scope, 1)).toBeUndefined();
  localStorage.setItem("mycellios.model-catalog.v1:user:space:connection", JSON.stringify({ at: 1, data: [{ id: 3 }] }));
  expect(readCachedMycelliosCatalog(scope, 2)).toBeUndefined();
});
