import { json, serve } from "https://deno.land/x/sift@0.6.0/mod.ts";
import {
  createBot,
  Intents,
  MessageTypes,
  startBot,
} from "https://deno.land/x/discordeno@13.0.0/mod.ts";

import * as anthropic from "./anthropic.ts";
import * as openai from "./openai.ts";
import { redis } from "./redis.ts";
import { createLog } from "./logger.ts";
import { shutdown } from "./shutdown.ts";
import { retry } from "./retry.ts";
import { ContentType, supportedContentTypes } from "./ai.ts";

// todo: Don't hardcode these role ids
const AI_CURIOUS_ROLE_IDS = [1098370802526724206n, 1123952489562132540n];
const DISCORD_CLIENT_ID = BigInt(Deno.env.get("DISCORD_CLIENT_ID") as string);
const DISCORD_TOKEN = Deno.env.get("DISCORD_TOKEN") as string;
const INITIAL_MENTION = new RegExp(`^<@${DISCORD_CLIENT_ID}>\s*`);
const MIDWAY_MENTION = new RegExp(`<@${DISCORD_CLIENT_ID}>`);

const instanceLog = createLog();

const acquireTask = async (id: string) => {
  return await redis.set("task:" + id, 1, { nx: true, ex: 30 });
};

const continueTyping = (channelId: bigint) => {
  const interval = setInterval(() => bot.helpers.startTyping(channelId), 5000);
  return () => clearInterval(interval);
};

const isDev = Deno.env.get("LOCAL_DEV") === "true";

type Provider = "openai" | "anthropic";

const setProvider = async (
  channelId: bigint,
  provider: Provider,
) => {
  return await redis.set("provider:" + channelId, provider);
};

const getProvider = async (channelId: bigint): Promise<Provider> => {
  return await redis.get("provider:" + channelId) || "openai" as Provider;
};

const deployment = new Date().toISOString();

const bot = createBot({
  token: DISCORD_TOKEN,
  intents: Intents.GuildMessages | Intents.MessageContent,
  events: {
    async messageCreate(bot, msg) {
      const {
        id,
        authorId,
        channelId,
        member,
        mentionedUserIds,
        type,
      } = msg;

      if (authorId === DISCORD_CLIENT_ID) return;
      if (type === MessageTypes.Reply) return;
      if (!isDev && !mentionedUserIds.includes(DISCORD_CLIENT_ID)) return;
      if (isDev && !msg.content.startsWith("!dev ")) return;

      if (isDev) {
        msg.content = msg.content.replace(/^!dev /, "");
      }

      const { content } = msg;

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

      const respond = async (
        response: string | { answer: string; imageUrl?: string },
        { finished = true }: { finished?: boolean } = {},
      ) => {
        log.info("Sending response", { response });

        const embeds = typeof response !== "string" && response.imageUrl
          ? [{ image: { url: response.imageUrl } }]
          : undefined;

        const answer = typeof response === "string"
          ? response
          : response.answer;

        try {
          await retry(() =>
            bot.helpers.sendMessage(channelId, {
              embeds,
              content: `<@${authorId}> ${answer}`,
            })
          );
        } catch (error: unknown) {
          log.error("Failed sending response to Discord", {
            errorMessage: (error as Error).message,
          });
        }

        if (finished) shutdown.allow();
      };

      if (!member?.roles?.some((role) => AI_CURIOUS_ROLE_IDS.includes(role))) {
        return respond(
          "Sorry, you need the `ai-curious` role to talk to me.",
        );
      }

      if (
        msg.attachments.some((attachment) =>
          !supportedContentTypes.includes(
            attachment.contentType! as ContentType,
          )
        )
      ) {
        return respond(
          "Only PNG, JPEG, WEBP, and GIF images are supported at the moment.",
        );
      }

      if (!isDev && !INITIAL_MENTION.test(content)) {
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

      if (question === "deployment") {
        return respond(deployment);
      }

      if (question.startsWith("!provider ")) {
        const provider = ((): Provider | undefined => {
          if (msg.content.includes("openai")) return "openai";
          if (msg.content.includes("anthropic")) return "anthropic";
        })();

        if (!provider) {
          return respond("Please specify a valid provider (openai, anthropic)");
        }

        const didSet = await setProvider(channelId, provider);

        if (!didSet) {
          return respond("Failed to set provider. Please try again later.");
        }

        return respond(`This channel is now using ${provider}`);
      }

      log.info("Question", { question });

      const images = msg.attachments.map(({ url, contentType }) => ({
        url,
        contentType: contentType as ContentType,
      }));

      if (!question) {
        return respond("Don't @ me unless you have a question.");
      }

      if (MIDWAY_MENTION.test(question)) {
        return respond(
          "Don't @ me multiple times, please.",
        );
      }

      const provider = await getProvider(channelId);

      const ai = ({
        openai,
        anthropic,
      })[provider];

      const stopTyping = continueTyping(channelId);

      try {
        const answer = await ai.ask({
          question,
          channelId,
          log,
          images,
          notify: (m) => respond(m, { finished: false }),
        });

        return await respond(answer);
      } catch (error: unknown) {
        log.error("Error", { errorMessage: (error as Error).message });

        try {
          // @ts-ignore: logging raw errors may not be supported
          log.error(error);
        } catch {
          // don't care about this
        }

        return await respond("Something went wrong 😢 Please try again!");
      } finally {
        stopTyping();
      }
    },
  },
});

await startBot(bot);

serve({
  "/": () => {
    return json({ ping: "pong" });
  },
  404: ({ url, referrer }) => {
    instanceLog.info("404 Not found", { url, referrer });
    return json({ message: "Not Found" });
  },
});
