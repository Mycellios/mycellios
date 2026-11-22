import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MEMORY_EMBEDDING_CANARY_MIN_COSINE, MEMORY_EMBEDDING_CANARY_QUERY, MEMORY_EMBEDDING_DIMENSIONS, MEMORY_EMBEDDING_FILES,
  MEMORY_EMBEDDING_MAX_INPUTS, MEMORY_EMBEDDING_MODEL, MEMORY_EMBEDDING_PHONE_DIGEST, MEMORY_EMBEDDING_PHONE_EXECUTIONS,
  MEMORY_EMBEDDING_PHONE_FILES, MEMORY_EMBEDDING_PHONE_RUNTIME, MEMORY_EMBEDDING_PHONE_SOURCE, MEMORY_EMBEDDING_REVISION,
  MEMORY_EMBEDDING_UPSTREAM_MODEL, memoryEmbeddingCanaryReference,
} from "../src/contracts/memory-embedding.js";

/** The Android host's copy of the contract; it must not drift. */
const JAVA = readFileSync(new URL("../src/agent/apps/android/app/src/main/java/com/mycellios/android/embedding/MemoryEmbeddingPins.java", import.meta.url), "utf8");
const javaString = (name: string) => {
  const match = new RegExp(`static final String ${name} =\\s*"([^"]*)"`).exec(JAVA);
  if (!match) throw new Error(`missing ${name}`);
  return JSON.parse(`"${match[1]}"`) as string;
};
const javaNumber = (name: string) => {
  const match = new RegExp(`static final (?:int|double) ${name} = ([0-9_.]+);`).exec(JAVA);
  if (!match) throw new Error(`missing ${name}`);
  return Number(match[1]!.replaceAll("_", ""));
};

describe("Android memory-embedding pins", () => {
  it("mirror the model, revision and limits", () => {
    expect(javaString("MODEL")).toBe(MEMORY_EMBEDDING_MODEL);
    expect(javaString("UPSTREAM_MODEL")).toBe(MEMORY_EMBEDDING_UPSTREAM_MODEL);
    expect(javaString("REVISION")).toBe(MEMORY_EMBEDDING_REVISION);
    expect(javaString("CANARY_QUERY")).toBe(MEMORY_EMBEDDING_CANARY_QUERY);
    expect(javaNumber("DIMENSIONS")).toBe(MEMORY_EMBEDDING_DIMENSIONS);
    expect(javaNumber("MAX_INPUTS")).toBe(MEMORY_EMBEDDING_MAX_INPUTS);
    expect(javaNumber("CANARY_MIN_COSINE")).toBe(MEMORY_EMBEDDING_CANARY_MIN_COSINE);
    expect(javaString("PINNED_TOKENIZER_SHA256")).toBe(MEMORY_EMBEDDING_FILES["tokenizer.json"]);
  });

  it("apply the replica's query instruction", () => {
    const python = readFileSync(new URL("../python/distributed_runtime/qwen06_embedding_service.py", import.meta.url), "utf8");
    const instruction = /QUERY_INSTRUCTION = "([^"]*)"/.exec(python)![1]!.replaceAll("\\n", "\n");
    expect(javaString("QUERY_INSTRUCTION")).toBe(instruction);
  });

  it("mirror the phone artifact, its identity and the canary reference", () => {
    expect(javaString("PHONE_RUNTIME")).toBe(MEMORY_EMBEDDING_PHONE_RUNTIME);
    expect(javaString("PHONE_SOURCE_REPOSITORY")).toBe(MEMORY_EMBEDDING_PHONE_SOURCE.repository);
    expect(javaString("PHONE_SOURCE_REVISION")).toBe(MEMORY_EMBEDDING_PHONE_SOURCE.revision);
    expect(javaString("PHONE_DIGEST")).toBe(MEMORY_EMBEDDING_PHONE_DIGEST);
    const files = [...JAVA.matchAll(/new PinnedFile\("([^"]+)", ([0-9_]+)L, "([a-f0-9]{64})"\)/g)]
      .map(([, path, bytes, sha256]) => [path, { bytes: Number(bytes!.replaceAll("_", "")), sha256 }]);
    expect(Object.fromEntries(files)).toEqual(MEMORY_EMBEDDING_PHONE_FILES);
    expect(MEMORY_EMBEDDING_PHONE_FILES["tokenizer.json"]!.sha256).toBe(MEMORY_EMBEDDING_FILES["tokenizer.json"]);
    const base64 = [...JAVA.slice(JAVA.indexOf("CANARY_REFERENCE_BASE64 ="), JAVA.indexOf("private static float[] canaryReference"))
      .matchAll(/"([A-Za-z0-9+/=]+)"/g)].map((match) => match[1]).join("");
    expect(new Float32Array(new Uint8Array(Buffer.from(base64, "base64")).buffer)).toEqual(memoryEmbeddingCanaryReference());
  });

  it("admit no phone execution until a physical phone is measured", () => {
    expect(MEMORY_EMBEDDING_PHONE_EXECUTIONS).toEqual([]);
    expect(JAVA).toContain("PHONE_EXECUTION_ADMITTED = false;");
  });
});
