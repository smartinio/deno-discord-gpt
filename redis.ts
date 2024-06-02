import { Redis } from "https://deno.land/x/upstash_redis@v1.14.0/mod.ts";

export const redis = Redis.fromEnv({ automaticDeserialization: true });

type ReleaseLock = () => Promise<number>;

const key = (resource: bigint) => `lock:${resource}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createLock = async (resource: bigint) => {
  const status = await redis.set(key(resource), 1, { nx: true, ex: 10 });
  if (status === "OK") return () => redis.del(key(resource));
  return "ALREADY_LOCKED";
};

const acquireLock = async (resource: bigint): Promise<ReleaseLock> => {
  while (true) {
    const result = await createLock(resource);

    if (result === "ALREADY_LOCKED") {
      await sleep(500);
    } else {
      return result;
    }
  }
};

export const lock = async <T>(
  resource: bigint,
  callback: () => Promise<T>,
): Promise<T> => {
  const releaseLock = await acquireLock(resource);

  return callback().finally(releaseLock);
};
