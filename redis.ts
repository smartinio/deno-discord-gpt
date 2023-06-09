import { Redis } from "https://deno.land/x/upstash_redis@v1.14.0/mod.ts";
import { Log } from "./logger.ts";

export const redis = Redis.fromEnv({ automaticDeserialization: true });

type ReleaseLock = () => Promise<number>;

const key = (resource: bigint) => `lock:${resource}`;

const createLock = async (resource: bigint) => {
  const status = await redis.set(key(resource), 1, { nx: true, ex: 10 });
  if (status === "OK") return () => redis.del(key(resource));
  return "ALREADY_LOCKED";
};

const acquireLock = async (resource: bigint) => {
  return await new Promise<ReleaseLock>((resolve, reject) => {
    const acquire = async () => {
      const result = await createLock(resource).catch(reject);
      if (result === "ALREADY_LOCKED") setTimeout(acquire, 500);
      else if (result) resolve(result);
    };

    acquire();
  });
};

export const lock = async <T>(
  resource: bigint,
  log: Log,
  callback: () => Promise<T>,
): Promise<T> => {
  const meta = { resource: String(resource) };

  log.info("Acquiring redis lock...", meta);

  const releaseLock = await acquireLock(resource);

  log.info("Acquired redis lock", meta);

  const result = await callback();

  await releaseLock();

  log.info("Released redis lock", meta);

  return result;
};
