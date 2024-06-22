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

const isDev = Deno.env.get("LOCAL_DEV") === "true";
const delay = isDev ? 0 : 30000;

const sleep = (ms: number) =>
  new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms));

globalThis.addEventListener("unhandledrejection", async (e) => {
  instanceLog.error("Unhandled rejection:", e.reason);
  shutdown.imminent = true;
  const race = await Promise.race([sleep(delay), pendingWorkPromise]);
  instanceLog.info("Exiting in unhandled rejection", { race });
  Deno.exit();
});

gracefulShutdown(async (type) => {
  instanceLog.info("Shutdown signal received", { type });
  shutdown.imminent = true;
  const race = await Promise.race([sleep(delay), pendingWorkPromise]);
  instanceLog.info("Exiting in graceful shutdown", { type, race });
  Deno.exit();
});
