import { expect, it } from "vitest";
import { activityKind } from "./activity-kind";
it.each([
 ['Running: Get-Location; if(Test-Path PROJECT.md){Get-Content PROJECT.md}', 'files'],
 ['Running: ssh jarvis-live "cd /srv/private && git diff"', 'changes'],
 ['Running: npm test -- --run', 'tests'], ['Run tests', 'tests'], ['Read file', 'files'], ['Web search', 'web'],
 ['Apply patch', 'editing'], ['Schedule create', 'schedule'], ['Unknown tool /private/token', 'tool'],
 ['Using search_history', 'history'],
])('summarizes %s without exposing its arguments', (input, kind) => expect(activityKind(input)).toBe(kind));
