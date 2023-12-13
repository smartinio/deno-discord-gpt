import { OpenAI } from "https://deno.land/x/openai@v4.20.0/mod.ts";

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

const VERSION = 14;

export const ask = async (
  question: string,
  channelId: bigint,
  log: Log,
): Promise<string> => {
  return await lock(channelId, log, async () => {
    if (question.toLowerCase() === "reset") {
      await reset(channelId);
      return "History reset. I no longer remember what we've said in this channel.";
    }

    if (question.toLowerCase() === "version") {
      return String(VERSION);
    }

    const newMessages = [] as Message[];
    const history = await getHistory(channelId);

    if (history.length === 0) {
      newMessages.push(initialMessage);
    }

    newMessages.push({ role: "user", content: question });

    const messages = history.concat(newMessages);

    log.info("Querying OpenAI", {
      channelId: String(channelId),
      messages: JSON.stringify(messages.map((m) => m.content)),
    });

    const answer = await openAI.chat.completions.create({
      model: "gpt-4",
      messages,
    });

    const [reply] = answer.choices;

    if ((answer.usage?.total_tokens ?? 0) > 3500) {
      log.info("Reset due to usage", { ...answer.usage });
      await reset(channelId);
    } else {
      await remember(channelId, ...newMessages, reply.message);
    }

    return reply.message.content ?? "No response from OpenAI 🤷‍♂️";
  });
};
