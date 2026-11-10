/** First text is immediate; subsequent writes are bounded without delaying full bursts. */
export const TEXT_PROGRESS_INTERVAL_MS = 80;
export function shouldPublishTextProgress(now: number, lastPublishedAt: number, pendingLength: number): boolean {
  return pendingLength > 0 && (lastPublishedAt === 0 || now - lastPublishedAt >= TEXT_PROGRESS_INTERVAL_MS || pendingLength >= 2048);
}
