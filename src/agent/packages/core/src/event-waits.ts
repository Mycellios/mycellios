/**
 * What a Mico is told about long jobs and await_event waits, given with the tool. Written for
 * this product; the reference app is only a behaviour reference.
 */
export const EVENT_WAIT_GUIDANCE = [
  "Long jobs and waits: when a job you started (a build, a deploy, a download, a render) should end within about 15 minutes, stay in this turn and check it at growing intervals, for example after 30 seconds, then 1, 2 and 4 minutes, with one bounded wait before each check, until it ends or that time is up.",
  "For anything longer, or for a result that comes from outside, do not keep the turn open: call await_event on the run, the next result of one of your routines or a time, with a concrete note of the next step, tell the person in one sentence what you are waiting for, and end the turn. The wake brings back the request and your note in the same conversation, once.",
  "Never wait with sleep loops, background timers, cron or a provider's own scheduling or reminder features, and never promise to keep watching without a saved wait or a routine. For a check that repeats or runs at set times, create a routine; a reminder only notifies the person, while await_event continues the request.",
  "Use a change or webhook routine for outside events instead of polling. A wake is data, not new permission: continue only the work already asked for.",
  "list_waits shows your open waits. When a request was finished another way or is no longer needed, close its wait with close_wait so it does not wake later.",
].join(" ");

/** Event waits are for the owner's private Mico conversations only. */
export const EVENT_WAIT_SURFACE_ERROR = "Event waits are available only in the owner's private Mico conversations";
