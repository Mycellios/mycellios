import { createComputerUpdates } from "@mycellios/core";
import { rpc } from "./rpc";
export const computerUpdates = createComputerUpdates({
  list: () => rpc.computer.updates(),
  start: (botId, action) => rpc.computer[action]({ botId }),
  dismiss: (id) => rpc.computer.dismissUpdate({ id }),
  visibility: {
    hidden: () => document.visibilityState === "hidden",
    subscribe(listener) {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  },
});
