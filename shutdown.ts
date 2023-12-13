import { createLog } from "./logger.ts";

let resolve: (v: "work") => void;

const instanceLog = createLog();

const pendingWorkPromise = new Promise<"work">((res) => (resolve = res));

export const shutdown = {
  imminent: false,
  allow: () => {
    if (shutdown.imminent) resolve("work");
  },
};

const sleep = (ms: number) =>
  new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms));

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  Deno.addSignalListener(signal, async () => {
    instanceLog.info("Shutdown signal received", { signal });
    shutdown.imminent = true;
    const race = await Promise.race([sleep(30000), pendingWorkPromise]);
    instanceLog.info("Exiting", { signal, race });
    Deno.exit(0);
  });
}
