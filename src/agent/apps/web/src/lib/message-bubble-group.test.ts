import { describe, expect, it } from "vitest";
import type { ThreadMessage } from "@rakazo/contracts";
import { joinMessageBubbles } from "./message-bubble-group";
const message = (extra: Partial<ThreadMessage> = {}): ThreadMessage => ({id:"a",threadId:"thread",seq:1,role:"bot",botId:"mico",createdAt:"2026-11-11T12:00:00Z",blocks:[{kind:"text",text:"Hello"}],...extra});
describe("message bubble groups", () => {
 it("joins adjacent replies and user messages without merging their identities", () => {
  expect(joinMessageBubbles(message(), message({id:"b",seq:2}))).toBe(true);
  expect(joinMessageBubbles(message({role:"user"}),message({role:"user"}))).toBe(true);
 });
 it("keeps authors, threads and explicit boundaries separate", () => {
  expect(joinMessageBubbles(message(),message({botId:"other"}))).toBe(false);
  expect(joinMessageBubbles(message(),message({role:"user"}))).toBe(false);
  expect(joinMessageBubbles(message(),message({threadId:"other"}))).toBe(false);
  expect(joinMessageBubbles(message(),message(),true)).toBe(false);
 });
 it("breaks on time gaps, calls, quoted replies and interactive cards", () => {
  expect(joinMessageBubbles(message(),message({createdAt:"2026-11-11T12:05:00Z"}))).toBe(false);
  expect(joinMessageBubbles(message(),message({callId:"call"}))).toBe(false);
  expect(joinMessageBubbles(message(),message({replyToMessageId:"a"}))).toBe(false);
  expect(joinMessageBubbles(message(),message({blocks:[]}))).toBe(false);
  expect(joinMessageBubbles(message(),message({blocks:[{kind:"progress",text:"Running command",activity:true}]}))).toBe(false);
 });
 it("keeps streamed text connected while steps-only activity remains separate", () => {
  expect(joinMessageBubbles(message(),message({blocks:[{kind:"progress",text:"Still checking"}]}))).toBe(true);
  expect(joinMessageBubbles(message(),message({blocks:[{kind:"steps",steps:[{label:"Search",count:1}]}]}))).toBe(false);
 });
});
