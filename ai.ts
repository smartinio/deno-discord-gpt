import type { Log } from "./logger.ts";
import { redis } from "./redis.ts";

export const supportedContentTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type ContentType = typeof supportedContentTypes[number];

export type AskAI = {
  question: string;
  channelId: bigint;
  log: Log;
  images?: { url: string; contentType: ContentType }[];
  notify: (message: string) => void;
  model?: string;
};

export const createCache = <T>(namespace: string) => {
  const key = (channelId: bigint) => `history:${namespace}:${channelId}`;

  const getHistory = async (channelId: bigint) => {
    return await redis.lrange(key(channelId), 0, -1) as T[];
  };

  const remember = async (channelId: bigint, ...messages: T[]) => {
    await redis.rpush(key(channelId), ...messages);
  };

  const reset = async (channelId: bigint) => {
    await redis.del(key(channelId));
  };

  return {
    getHistory,
    remember,
    reset,
  };
};
