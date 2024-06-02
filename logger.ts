import { Node as Logtail } from "https://esm.sh/@logtail/js@0.4.3";

const LOGTAIL_SOURCE_TOKEN = Deno.env.get("LOGTAIL_SOURCE_TOKEN");

const instanceId = crypto.randomUUID();

export type Log = ReturnType<typeof createLog>;

export const createLog = <T>(extra?: T) => {
  if (!LOGTAIL_SOURCE_TOKEN) return console;

  const log = new Logtail(LOGTAIL_SOURCE_TOKEN, { batchInterval: 1000 });

  log.use((payload) => Promise.resolve({ ...payload, instanceId, ...extra }));

  return log;
};

export const list = <T>(array: T[]) =>
  Object.fromEntries(
    array.map((message, idx) => [String(idx), message]),
  );
