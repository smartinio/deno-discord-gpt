import { json, serve } from "https://deno.land/x/sift@0.6.0/mod.ts";
import {
  createBot,
  Intents,
  MessageTypes,
  startBot,
} from "https://deno.land/x/discordeno@13.0.0/mod.ts";

import { ask } from "./openai.ts";
import { redis } from "./redis.ts";
import { createLog } from "./logger.ts";
import { shutdown } from "./shutdown.ts";
import { retry } from "./retry.ts";

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

const supportedContentTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

const bot = createBot({
  token: DISCORD_TOKEN,
  intents: Intents.GuildMessages | Intents.MessageContent,
  events: {
    async messageCreate(bot, msg) {
      const {
        id,
        authorId,
        channelId,
        content,
        member,
        mentionedUserIds,
        type,
      } = msg;

      if (authorId === DISCORD_CLIENT_ID) return;
      if (type === MessageTypes.Reply) return;
      if (!mentionedUserIds.includes(DISCORD_CLIENT_ID)) return;

      const messageId = String(id);

      const log = createLog({ messageId, from: msg.member?.nick });

      if (shutdown.imminent) {
        log.info("Shutdown imminent, skipping message");
        return shutdown.allow();
      }

      const taskStatus = await acquireTask(messageId);

      if (taskStatus !== "OK") {
        if (shutdown.imminent) shutdown.allow();
        return;
      }

      log.info("Processing message", { content, att: msg.attachments });

      bot.helpers.startTyping(channelId);

      const respond = async (answer: string) => {
        log.info("Sending response", { answer });

        try {
          await retry(() =>
            bot.helpers.sendMessage(channelId, {
              content: `<@${authorId}> ${answer}`,
            })
          );
        } catch (error: unknown) {
          log.error("Failed sending response to Discord", {
            message: (error as Error).message,
          });
        }

        shutdown.allow();
      };

      if (!member?.roles?.some((role) => AI_CURIOUS_ROLE_IDS.includes(role))) {
        return respond(
          "Sorry, you need the `ai-curious` role to talk to me.",
        );
      }

      if (
        msg.attachments.some((attachment) =>
          !supportedContentTypes.includes(attachment.contentType!)
        )
      ) {
        return respond(
          "Only PNG, JPEG, WEBP, and GIF images are supported at the moment.",
        );
      }

      if (!INITIAL_MENTION.test(content)) {
        return respond(
          `Please @ me before your question like this: <@${DISCORD_CLIENT_ID}> what is the meaning of life?`,
        );
      }

      const nonBotMentions = mentionedUserIds.filter((id) =>
        id !== DISCORD_CLIENT_ID
      );

      if (nonBotMentions.length > 0) {
        return respond(
          "Don't @ anyone else when talking to me, please.",
        );
      }

      const question = content.replace(INITIAL_MENTION, "").trim();
      const imageUrls = msg.attachments.map((a) => a.url);

      if (!question) {
        return respond("Don't @ me unless you have a question.");
      }

      if (MIDWAY_MENTION.test(question)) {
        return respond(
          "Don't @ me multiple times, please.",
        );
      }

      const stopTyping = continueTyping(channelId);

      try {
        const answer = await ask({
          question,
          channelId,
          log,
          imageUrls,
        }).finally(stopTyping);

        return respond(answer);
      } catch (error: unknown) {
        log.error("Error", { message: (error as Error).message });
        try {
          // @ts-ignore
          log.error(error);
        } catch {}
        return respond("Something went wrong 😢 Please try again!");
      }
    },
  },
});

await startBot(bot);

serve({
  "/": ({ referrer }) => {
    return json({ ping: "pong" });
  },
  404: ({ url, referrer }) => {
    instanceLog.info("404 Not found", { url, referrer });
    return json({ message: "Not Found" });
  },
});
