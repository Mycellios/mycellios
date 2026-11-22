/** Order of the messages in a conversation's queue (lowest position first). */

/** Rows without a stored position (written before positions existed) sort by message number. */
export function queuedPosition(row: { position: number | null; message: { seq: number } }) {
  return row.position ?? row.message.seq;
}

export function compareQueuedRows(
  a: { id: string; position: number | null; message: { seq: number } },
  b: { id: string; position: number | null; message: { seq: number } },
) {
  return (
    queuedPosition(a) - queuedPosition(b) ||
    a.message.seq - b.message.seq ||
    a.id.localeCompare(b.id)
  );
}
