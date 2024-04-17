import { gracefulShutdown } from "https://deno.land/x/easy_std@v0.7.1/mod.ts";
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

globalThis.addEventListener("unhandledrejection", (e) => {
  instanceLog.error("Unhandled rejection:", e.reason);
});

gracefulShutdown(async (type) => {
  instanceLog.info("Shutdown signal received", { type });
  shutdown.imminent = true;
  const race = await Promise.race([sleep(30000), pendingWorkPromise]);
  instanceLog.info("Exiting", { type, race });
  Deno.exit();
});
