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
const delay = isDev ? 0 : 10000;

const sleep = (ms: number) =>
  new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms));

const deploymentId = Deno.env.get("DENO_DEPLOYMENT_ID") as string;

const shutdownHandler = async (type: string) => {
  instanceLog.info("Shutdown signal received", { type, deploymentId });
  shutdown.imminent = true;
  const race = await Promise.race([sleep(delay), pendingWorkPromise]);
  instanceLog.info("Exiting in graceful shutdown", { type, race });
  Deno.exit(0);
};

globalThis.addEventListener("unhandledrejection", (e) => {
  console.error(e);
});

globalThis.addEventListener("error", (e) => {
  console.error(e);
});

gracefulShutdown(shutdownHandler);
