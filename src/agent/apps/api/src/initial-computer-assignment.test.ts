import { expect, it } from "vitest";
import { initialComputerAssignmentFilter } from "./initial-computer-assignment";
const placeholder = {scope:"team",kind:"none",providerRef:null,controlHolder:"none",controlBotId:null,executionRunId:null,executionBotId:null,executionLeaseExpiresAt:null};
it("permits answering the introduction while assigning a previously unused computer", () => {
  const filter=initialComputerAssignmentFilter(placeholder,"dedicated");
  expect(filter).toEqual({NOT:{status:"waiting_input",trigger:"created"}});
  // All other active work, including user questions, remains in the blocking query.
  for (const run of [{status:"running",trigger:"created"},{status:"queued",trigger:"created"},{status:"waiting_input",trigger:"user"}]) {
    expect(run).not.toEqual(filter.NOT);
  }
});
it.each([
  {kind:"fake"},{providerRef:"existing"},{scope:"dedicated"},
  {controlHolder:"user"},{controlHolder:"bot"},{controlBotId:"other"},
  {executionRunId:"work"},{executionBotId:"other"},{executionLeaseExpiresAt:new Date(0)},
])("never relaxes active-run blocking for a provisioned or occupied computer: %j", patch => {
  expect(initialComputerAssignmentFilter({...placeholder,...patch},"dedicated")).toEqual({});
});
it("does not relax dedicated-to-team changes",()=>expect(initialComputerAssignmentFilter(placeholder,"team")).toEqual({}));

it.each(["none", "bot"])("allows an idle Desktop greeting with holder %s without relaxing other runs", controlHolder => {
  const desktop={...placeholder,kind:"desktop",providerRef:"native-binding",controlHolder};
  expect(initialComputerAssignmentFilter(desktop,"dedicated"))
    .toEqual({NOT:{status:"waiting_input",trigger:"created"}});
});
it.each([
  {controlHolder:"user"},{controlBotId:"owner"},{executionRunId:"work"},
  {executionBotId:"other"},{executionLeaseExpiresAt:new Date()}, {scope:"dedicated"},
])("preserves occupied Desktop fences: %j", patch => {
  expect(initialComputerAssignmentFilter({...placeholder,kind:"desktop",providerRef:"native-binding",controlHolder:"bot",...patch},"dedicated")).toEqual({});
});
