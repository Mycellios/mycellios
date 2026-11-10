/** Longest common prefix, used to tell a restarted answer from a continuation. */
export function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

/**
 * A retried answer that opens with the same characters as the interrupted one is
 * starting over, not continuing it. Models restart with the first words of the
 * reply, so comparing the beginning is what tells the two apart.
 */
export function restartsReply(reply: string, retried: string, minimum = 4): boolean {
  if (!reply.trim() || !retried.trim()) return false;
  return commonPrefixLength(reply.trimStart(), retried.trimStart()) >= minimum;
}
