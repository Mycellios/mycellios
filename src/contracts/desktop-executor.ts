/** Outbound Desktop execution transport. Local OS credentials never cross this protocol. */
export interface DesktopExecutorOwner { userId: string; spaceId: string; sessionId: string }
export interface DesktopExecutorBinding { deviceId: string; botId: string; generation: string }
export interface DesktopExecutorOperation {
  id: string;
  binding: DesktopExecutorBinding;
  request: unknown;
}
export interface DesktopExecutorPoll {
  operations: DesktopExecutorOperation[];
  active: string[];
}
export interface DesktopExecutorResult { deviceId: string; id: string; seq: number; data: string; done: boolean }
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error("Invalid Desktop message");
  return value as Record<string, unknown>;
}
export function parseDesktopBinding(value: unknown): DesktopExecutorBinding {
  const input = object(value, ["deviceId", "botId", "generation"]);
  if (!uuid(input.deviceId) || !id(input.botId) || !uuid(input.generation)) throw new Error("Invalid Desktop binding");
  return { deviceId: input.deviceId, botId: input.botId, generation: input.generation };
}
export function parseDesktopPoll(value: unknown): { deviceId: string } {
  const input = object(value, ["deviceId"]);
  if (!uuid(input.deviceId)) throw new Error("Invalid Desktop device");
  return { deviceId: input.deviceId };
}
export function parseDesktopResult(value: unknown): DesktopExecutorResult {
  const input = object(value, ["deviceId", "id", "seq", "data", "done"]);
  if (!uuid(input.deviceId) || !uuid(input.id) || typeof input.seq !== "number" || !Number.isSafeInteger(input.seq) || input.seq < 0 || typeof input.data !== "string" || input.data.length > 350_000 || typeof input.done !== "boolean") throw new Error("Invalid Desktop result");
  return { deviceId: input.deviceId, id: input.id, seq: input.seq, data: input.data, done: input.done };
}
export function parseDesktopDispatch(value: unknown): { scope: { userId: string; spaceId: string }; nonce: string; request?: unknown; probe?: string } {
  const input = object(value, ["scope", "nonce", "request", "probe"]);
  const scope = object(input.scope, ["userId", "spaceId"]);
  if (!id(scope.userId) || !id(scope.spaceId) || !uuid(input.nonce) || (input.probe !== undefined && !id(input.probe))) throw new Error("Invalid Desktop dispatch");
  return { scope: { userId: scope.userId, spaceId: scope.spaceId }, nonce: input.nonce, request: input.request,
    ...(input.probe === undefined ? {} : { probe: input.probe as string }) };
}
