import { json, serve } from "https://deno.land/x/sift@0.6.0/mod.ts";
import {
  createBot,
  Intents,
  startBot,
} from "https://deno.land/x/discordeno@13.0.0/mod.ts";

import { ask } from "./openai.ts";
import { redis } from "./redis.ts";

const AI_CURIOUS_ROLE_ID = 1098370802526724206n;
const DISCORD_CLIENT_ID = BigInt(Deno.env.get("DISCORD_CLIENT_ID") as string);
const DISCORD_TOKEN = Deno.env.get("DISCORD_TOKEN") as string;
const INITIAL_MENTION = new RegExp(`^<@${DISCORD_CLIENT_ID}>[^A-Za-z0-9]*`);
const MIDWAY_MENTION = new RegExp(`<@${DISCORD_CLIENT_ID}>`);

const acquireTask = async (taskId: string) => {
  return await redis.set(taskId, 1, { nx: true, ex: 30 });
};

const bot = createBot({
  token: DISCORD_TOKEN,
  intents: Intents.GuildMessages | Intents.MessageContent,
  events: {
    async messageCreate(bot, message) {
      if (!message.member?.roles?.includes(AI_CURIOUS_ROLE_ID)) {
        return;
      }

      if (!message.mentionedUserIds.includes(DISCORD_CLIENT_ID)) {
        return;
      }

      const taskId = `task:${message.id}`;

      const taskStatus = await acquireTask(taskId);

      if (taskStatus !== "OK") {
        return;
      }

      bot.helpers.startTyping(message.channelId);

      const response = (content: string) => {
        return bot.helpers.sendMessage(message.channelId, {
          content: `<@${message.authorId}> ${content}`,
        });
      };

      if (!INITIAL_MENTION.test(message.content)) {
        return response(
          `Please @ me before your question like this: <@${bot.applicationId}> what is the meaning of life?`,
        );
      }

      const nonBotMentions = message.mentionedUserIds.filter((id) =>
        id !== DISCORD_CLIENT_ID
      );

      if (nonBotMentions.length > 0) {
        return response(
          "Don't @ anyone else when talking to me, please.",
        );
      }

      const question = message.content.replace(INITIAL_MENTION, "").trim();

      if (!question) {
        return response("Don't @ me unless you have a question.");
      }

      if (MIDWAY_MENTION.test(question)) {
        return response(
          "Don't @ me multiple times, please.",
        );
      }

      const answer = await ask(
        question,
        message.channelId,
        message.member?.nick,
      );

      return response(answer);
    },
    ready() {
      console.log("Successfully connected to gateway");
    },
  },
});

await startBot(bot);

serve({
  "/": () => json({ ping: "pong" }),
  404: () => json({ message: "Not Found" }),
});
