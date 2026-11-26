type ApprovalTarget = {
  userId: string;
  spaceId: string;
  botId: string;
  resourceId: string;
  toolName: string;
};

type ToolRoute = {
  connectorId: string;
  resourceId: string;
  toolName: string;
};

export function parsePrivateApprovalTarget(value?: string): ApprovalTarget | undefined {
  if (!value) return undefined;
  let target: unknown;
  try {
    target = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (target === null || typeof target !== "object" || Array.isArray(target)) {
    return undefined;
  }
  const fields = target as Record<string, unknown>;
  const { userId, spaceId, botId, resourceId, toolName } = fields;
  const valid = (value: unknown): value is string =>
    typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  if (
    Object.keys(fields).length !== 5 ||
    !valid(userId) || !valid(spaceId) || !valid(botId) ||
    !valid(resourceId) || !valid(toolName)
  ) {
    return undefined;
  }
  return { userId, spaceId, botId, resourceId, toolName };
}

export function requiresPrivateApproval(
  target: ApprovalTarget | undefined,
  actor: Pick<ApprovalTarget, "userId" | "spaceId" | "botId">,
  route: ToolRoute | undefined,
): boolean {
  return Boolean(
    target &&
    route &&
    route.connectorId === "mcp" &&
    actor.userId === target.userId &&
    actor.spaceId === target.spaceId &&
    actor.botId === target.botId &&
    route.resourceId === target.resourceId &&
    route.toolName === target.toolName
  );
}

export const privateApprovalTarget = parsePrivateApprovalTarget(
  process.env.MYCELLIOS_PRIVATE_REQUIRED_APPROVAL,
);
