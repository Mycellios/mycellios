import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { PC_COPY_FAILED, copyBeforeComputerSwitch } from "./computer-switch.js";

describe("copyBeforeComputerSwitch", () => {
  it("returns the copy's result", async () => {
    expect(await copyBeforeComputerSwitch("desktop", async () => "revision")).toBe("revision");
  });

  it("explains a PC that could not hand over its files instead of an internal error", async () => {
    const failure = copyBeforeComputerSwitch("desktop", async () => { throw new Error("relay closed"); });
    await expect(failure).rejects.toBeInstanceOf(ORPCError);
    await expect(failure).rejects.toMatchObject({ code: "BAD_REQUEST", message: PC_COPY_FAILED });
  });

  it("keeps an error that already explains itself", async () => {
    const known = new ORPCError("CONFLICT", { message: "busy" });
    await expect(copyBeforeComputerSwitch("desktop", async () => { throw known; })).rejects.toBe(known);
  });

  it("leaves failures of other computers unchanged", async () => {
    const failure = new Error("docker stop failed");
    await expect(copyBeforeComputerSwitch("docker", async () => { throw failure; })).rejects.toBe(failure);
  });
});
