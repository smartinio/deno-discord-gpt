import { json, serve } from "https://deno.land/x/sift@0.6.0/mod.ts";
import {
  createBot,
  Intents,
  startBot,
} from "https://deno.land/x/discordeno@13.0.0/mod.ts";

import { ask } from "./openai.ts";
import { redis } from "./redis.ts";
import { createLog } from "./logger.ts";

const AI_CURIOUS_ROLE_IDS = [1098370802526724206n, 1123952489562132540n];
const DISCORD_CLIENT_ID = BigInt(Deno.env.get("DISCORD_CLIENT_ID") as string);
const DISCORD_TOKEN = Deno.env.get("DISCORD_TOKEN") as string;
const INITIAL_MENTION = new RegExp(`^<@${DISCORD_CLIENT_ID}>[^A-Za-z0-9]*`);
const MIDWAY_MENTION = new RegExp(`<@${DISCORD_CLIENT_ID}>`);

const instanceLog = createLog();

const acquireTask = async (id: string) => {
  return await redis.set("task:" + id, 1, { nx: true, ex: 30 });
};

const continueTyping = (channelId: bigint) => {
  const interval = setInterval(() => bot.helpers.startTyping(channelId), 5000);
  return () => clearInterval(interval);
};

const bot = createBot({
  token: DISCORD_TOKEN,
  intents: Intents.GuildMessages | Intents.MessageContent,
  events: {
    async messageCreate(bot, msg) {
      const { id, authorId, channelId, content, member, mentionedUserIds } =
        msg;

      if (!member?.roles?.some((role) => AI_CURIOUS_ROLE_IDS.includes(role))) {
        return;
      }

      if (!mentionedUserIds.includes(DISCORD_CLIENT_ID)) {
        return;
      }

      const messageId = String(id);

      const taskStatus = await acquireTask(messageId);

      const log = createLog({ messageId });

      if (taskStatus !== "OK") {
        log.info("Message already being processed");
        return;
      }

      log.info("Processing message", { content });

      bot.helpers.startTyping(channelId);

      const response = (answer: string) => {
        log.info("Sending response", { answer });

        return bot.helpers.sendMessage(channelId, {
          content: `<@${authorId}> ${answer}`,
        });
      };

      if (!INITIAL_MENTION.test(content)) {
        return response(
          `Please @ me before your question like this: <@${DISCORD_CLIENT_ID}> what is the meaning of life?`,
        );
      }

      const nonBotMentions = mentionedUserIds.filter((id) =>
        id !== DISCORD_CLIENT_ID
      );

      if (nonBotMentions.length > 0) {
        return response(
          "Don't @ anyone else when talking to me, please.",
        );
      }

      const question = content.replace(INITIAL_MENTION, "").trim();

      if (!question) {
        return response("Don't @ me unless you have a question.");
      }

      if (MIDWAY_MENTION.test(question)) {
        return response(
          "Don't @ me multiple times, please.",
        );
      }

      const stopTyping = continueTyping(channelId);

      const answer = await ask(
        question,
        channelId,
        log,
        member?.nick,
      ).finally(stopTyping);

      return response(answer);
    },
    ready() {
      instanceLog.info("Successfully connected to gateway");
    },
  },
});

await startBot(bot);

serve({
  "/": ({ referrer }) => {
    instanceLog.info("Ping", { referrer });
    return json({ ping: "pong" });
  },
  404: ({ url, referrer }) => {
    instanceLog.info("404 Not found", { url, referrer });
    return json({ message: "Not Found" });
  },
});
