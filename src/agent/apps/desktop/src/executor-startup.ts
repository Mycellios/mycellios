/** Retry only native startup, before any Mico or user command can have run. */
export async function startDesktopExecutor<T>(start: () => Promise<T>, options: {
  report(code: string): void;
  delay?: (ms: number) => Promise<void>;
}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await start(); }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "START_FAILED";
      options.report(code);
      if (attempt >= 2 || !["EBUSY","EPERM","EADDRINUSE","EACCES"].includes(code)) throw error;
      await (options.delay ?? (ms => new Promise(resolve => setTimeout(resolve,ms))))(250 * (attempt + 1));
    }
  }
}
