import { OpenAI } from "https://deno.land/x/openai@v4.28.4/mod.ts";

import { lock, redis } from "./redis.ts";
import { Log } from "./logger.ts";

type ChatCompletionOptions = Parameters<
  OpenAI["chat"]["completions"]["create"]
>[0];

type Message = ChatCompletionOptions["messages"][number];

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") as string;

const openAI = new OpenAI({
  apiKey: OPENAI_API_KEY,
  maxRetries: 3,
});

const initialMessage: Message = {
  role: "system",
  content:
    "You are an assistant in a Discord channel. Answer as concisely as possible, but match the tone and language of the person talking to you. Don't overdo it. Skip emojis and excessive slang. Never try to be on a moral high ground. Don't censor profanity. Never tell the person you're talking to to be open minded or similar if they happen to be stereotypical or prejudicing. It's OK for this conversation.",
};

const key = (channelId: bigint) => `history:${channelId}`;

const getHistory = async (channelId: bigint) => {
  return await redis.lrange(key(channelId), 0, -1) as Message[];
};

const remember = async (channelId: bigint, ...messages: Message[]) => {
  await redis.rpush(key(channelId), ...messages);
};

const reset = async (channelId: bigint) => {
  await redis.del(key(channelId));
};

const VERSION = 18;

export const ask = async ({
  question,
  channelId,
  log,
  imageUrls,
}: {
  question: string;
  channelId: bigint;
  log: Log;
  imageUrls?: string[];
}): Promise<string> => {
  return await lock(channelId, log, async () => {
    if (question.toLowerCase() === "reset") {
      await reset(channelId);
      return "History reset. I no longer remember what we've said in this channel.";
    }

    if (question.toLowerCase() === "version") {
      return String(VERSION);
    }

    const newMessages = [] as Message[];
    const rawHistory = await getHistory(channelId);

    if (rawHistory.length === 0) {
      newMessages.push(initialMessage);
    }

    // Prevent past images from being re-parsed (also links expire)
    const history = rawHistory.map((message) => {
      if (message.role !== "user" || !Array.isArray(message.content)) {
        return message;
      }

      return {
        ...message,
        content: message.content.map(
          (content) => {
            if (content.type === "image_url") {
              return {
                type: "text",
                text: `[expired image link](${content.image_url.url})`,
              } as const;
            }
            return content;
          },
        ),
      };
    });

    const content: Message["content"] = [{ type: "text", text: question }];

    if (imageUrls?.length) {
      const images = imageUrls.map((url) => ({
        type: "image_url",
        image_url: { url, detail: "low" },
      } as const));

      content.push(...images);
    }

    newMessages.push({ role: "user", content });

    const messages = [...history, ...newMessages];

    log.info("Querying OpenAI", {
      channelId: String(channelId),
      messages: JSON.stringify(messages.map((m) => m.content)),
    });

    const answer = await openAI.chat.completions.create({
      model: "gpt-4-turbo",
      messages,
    });

    const [reply] = answer.choices;

    log.info("Usage", { total_tokens: answer.usage?.total_tokens });

    if ((answer.usage?.total_tokens ?? 0) > 3500) {
      log.info("Reset due to usage", { ...answer.usage });
      await reset(channelId);
    } else {
      await remember(channelId, ...newMessages, reply.message);
    }

    return reply.message.content ?? "No response from OpenAI 🤷‍♂️";
  });
};
