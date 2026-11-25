import { describe, expect, it } from "vitest";
import {
  canChangeSpaceRole,
  canInviteToSpace,
  canRemoveSpacePerson,
  SpaceInvitationCreateInputSchema,
  SpaceInviteTokenSchema,
  spaceRoleOf,
} from "./space-members.js";

describe("Space roles (specs/space-members)", () => {
  it("reads stored roles, comma lists included, and treats anything unknown as a member", () => {
    expect(spaceRoleOf("owner")).toBe("owner");
    expect(spaceRoleOf("admin, owner")).toBe("owner");
    expect(spaceRoleOf("admin")).toBe("admin");
    expect(spaceRoleOf("member")).toBe("member");
    expect(spaceRoleOf("guest")).toBe("member");
  });

  it("never lets anyone remove or change the owner", () => {
    for (const actor of ["owner", "admin", "member"] as const) {
      expect(canRemoveSpacePerson(actor, "owner")).toBe(false);
      expect(canChangeSpaceRole(actor, "owner")).toBe(false);
    }
  });

  it("lets admins invite and remove members, and only the owner change roles", () => {
    expect([
      canInviteToSpace("owner"),
      canInviteToSpace("admin"),
      canInviteToSpace("member"),
    ]).toEqual([true, true, false]);
    expect(canRemoveSpacePerson("owner", "admin")).toBe(true);
    expect(canRemoveSpacePerson("admin", "member")).toBe(true);
    expect(canRemoveSpacePerson("admin", "admin")).toBe(false);
    expect(canRemoveSpacePerson("member", "member")).toBe(false);
    expect(canChangeSpaceRole("owner", "member")).toBe(true);
    expect(canChangeSpaceRole("admin", "member")).toBe(false);
  });

  it("normalizes invited addresses and accepts only 32-byte link tokens", () => {
    expect(
      SpaceInvitationCreateInputSchema.parse({ kind: "email", email: "  Guest@Example.TEST " }),
    ).toEqual({ kind: "email", email: "guest@example.test" });
    expect(
      SpaceInvitationCreateInputSchema.safeParse({ kind: "email", email: "nope" }).success,
    ).toBe(false);
    expect(SpaceInvitationCreateInputSchema.parse({ kind: "link" })).toEqual({ kind: "link" });
    expect(SpaceInviteTokenSchema.safeParse("a".repeat(43)).success).toBe(true);
    for (const token of ["a".repeat(42), "a".repeat(44), `${"a".repeat(42)}/`])
      expect(SpaceInviteTokenSchema.safeParse(token).success).toBe(false);
  });
});
