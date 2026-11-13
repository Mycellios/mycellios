// UI-only double, resolved solely by the isolated browser qualification server.
import type { MobileWorkerSnapshot } from "../../../../../mobile/runtime";
const listeners = new Set<(value: MobileWorkerSnapshot) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
const emit = () => listeners.forEach(listener => listener({ ...state }));
const state = { running: false, starting: false, backend: "cpu", level: "low", connection: "offline",
  connectionLabel: "Test only", statusText: "Test only", gpuLabel: "Test only", estimatedGflops: 0,
  verifiedTasks: 0, wakeLockActive: false, activity: [] } as MobileWorkerSnapshot;
export function initializeMobileWorker() {}
export function subscribeMobileWorker(value: (state: MobileWorkerSnapshot) => void) { listeners.add(value); value({ ...state }); return () => { listeners.delete(value); }; }
export function getMobileWorkerSnapshot() { return { ...state }; }
export function getMobileWorkerAccountProof() { return { workerId: "32cb4b44-cd2e-45d5-966e-b876f4c4dba0", token: "x".repeat(43) }; }
export async function startMobileWorker() { state.running = true; state.connection = "connecting"; emit();
  timer = setTimeout(() => { state.connection = "online"; emit(); }, 100); }
export async function stopMobileWorker() { clearTimeout(timer); state.running = false; state.connection = "offline"; emit(); }
