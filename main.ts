import { json, serve } from "https://deno.land/x/sift@0.6.0/mod.ts";
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import {
  ChannelTypes,
  createBot,
  FileContent,
  Intents,
  MessageTypes,
  startBot,
} from "https://deno.land/x/discordeno@18.0.0/mod.ts";

import * as anthropic from "./anthropic.ts";
import * as openai from "./openaiv2.ts";
import { redis } from "./redis.ts";
import { createLog } from "./logger.ts";
import { shutdown } from "./shutdown.ts";
import { retry } from "./retry.ts";
import { ContentType, supportedContentTypes } from "./ai.ts";
import { chunkString } from "./strings.ts";
import { fetchGeneratedImage, fetchImageBlob } from "./images.ts";

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

const providerModels = [
  "openai:o3",
  "anthropic:claude-3-5-sonnet-latest",
] as const;

type Provider = typeof providerModels[number];

const setProvider = async (channelId: bigint, provider: Provider) => {
  return await redis.set("provider:" + channelId, provider);
};

const getProviderModel = async (
  channelId: bigint,
): Promise<Provider | null> => {
  return await redis.get("provider:" + channelId);
};

export const deployment = new Date().toISOString();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const baseUrl = Deno.env.get("BASE_URL") || "http://localhost:8000";

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

      const connectIp = /connect (\d+\.\d+\.\d+\.\d+:\d+)$/;

      if (connectIp.test(msg.content)) {
        const taskStatus = await acquireTask(String(msg.id));

        if (taskStatus !== "OK") {
          if (shutdown.imminent) shutdown.allow();
          return;
        }

        const ip = connectIp.exec(msg.content)?.[1];

        return await bot.helpers.sendMessage(msg.channelId, {
          content: `${baseUrl}/steam/connect/${ip}`,
        });
      }

      const chan = await bot.helpers.getChannel(channelId);

      const isAiResponseThread = chan.type === ChannelTypes.PublicThread ||
        chan.type === ChannelTypes.PrivateThread &&
          chan.ownerId === DISCORD_CLIENT_ID;

      if (
        !isDev && !mentionedUserIds.includes(DISCORD_CLIENT_ID) &&
        !isAiResponseThread
      ) return;

      if (isDev && !msg.content.startsWith("!dev ") && !isAiResponseThread) {
        return;
      }

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

      const question = content.replace(INITIAL_MENTION, "").trim();

      let threadId;

      if (
        chan.type === ChannelTypes.PublicThread ||
        chan.type === ChannelTypes.PrivateThread
      ) {
        threadId = chan.id;
      } else {
        let threadName = `❓ ${question}`.slice(0, 100);

        if (threadName.length === 100) {
          threadName = threadName.slice(0, threadName.length - 1) + "…";
        }

        const thread = await bot.helpers.startThreadWithMessage(
          channelId,
          id,
          {
            name: threadName,
            autoArchiveDuration: 60,
          },
        );

        threadId = thread.id;
      }

      const respond = async (
        response: string | { answer: string; imageUrl?: string },
        { finished = true }: { finished?: boolean } = {},
      ) => {
        log.info("Sending response", { response });

        const file: FileContent | undefined =
          typeof response !== "string" && response.imageUrl
            ? {
              name: new URL(response.imageUrl).pathname.split("/").at(-1) ||
                "unknown.png",
              blob: await fetchImageBlob(response.imageUrl),
            }
            : undefined;

        if (file && typeof response !== "string" && response.imageUrl) {
          log.info("File attachment", { name: file.name, url: response.imageUrl })
        }

        const answer = typeof response === "string"
          ? response
          : response.answer;

        const prefix = ``;
        const ticks = "```";
        const ln = "\n";

        const chunks = chunkString(
          answer,
          2000 - prefix.length - 2 * (ticks.length + ln.length),
        );

        try {
          for (let i = 0; i < chunks.length; i++) {
            let chunk = chunks[i];

            if (i === 0) {
              chunk = prefix + chunk;
            }

            const tickCount = chunk.match(/```/g)?.length || 0;

            if (tickCount % 2 === 1) {
              chunk += ln + ticks;
              if (chunks[i + 1]) chunks[i + 1] = ticks + ln + chunks[i + 1];
            }

            if (i > 0) {
              await sleep(500);
            }

            await retry(() =>
              bot.helpers.sendMessage(threadId, {
                file: i === chunks.length - 1 ? file : undefined,
                content: chunk,
              })
            );
          }
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

      if (!isDev && !INITIAL_MENTION.test(content) && !isAiResponseThread) {
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

      if (question === "deployment") {
        return respond(deployment);
      }

      if (/^provider .+$/.test(question)) {
        const provider = providerModels.find((providerModel) =>
          msg.content.includes(providerModel)
        );

        if (!provider) {
          return respond(
            "Please specify a valid provider: " +
              providerModels.map((p) => `\`${p}\``).join(", "),
          );
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

      const providerModel = (await getProviderModel(channelId)) ||
        chan.parentId &&
          (await getProviderModel(chan.parentId)) ||
        "openai:gpt-4o";

      const [provider, model] = providerModel.split(":");

      const ai = ({
        openai,
        anthropic,
      })[provider];

      if (!ai) {
        return respond("Invalid provider model configured " + providerModel);
      }

      if (question === "provider") {
        return respond(providerModel);
      }

      const stopTyping = continueTyping(channelId);

      try {
        const answer = await ai.ask({
          question,
          channelId: threadId,
          log,
          images,
          notify: (m) => respond(m, { finished: false }),
          model,
        });

        return await respond(answer);
      } catch (error: unknown) {
        try {
          console.error(error);
          log.error("Error", { errorMessage: (error as Error).message });
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
  "/generated-image/:id": async (_req, _info, { id }) => {
    if (!id) return new Response(null, { status: 404 });

    const imageBase64 = await fetchGeneratedImage(id);

    if (!imageBase64) return new Response(null, { status: 404 });

    const bytes = decodeBase64(imageBase64);

    return new Response(bytes, {
      headers: { "Content-Type": "image/jpeg" },
    });
  },
  "/steam/connect/:ip": (_req, _info, params) => {
    if (!params?.ip?.match(/^\d+\.\d+\.\d+\.\d+:\d+$/)) {
      return new Response(null, { status: 400 });
    }

    return new Response(null, {
      status: 302,
      headers: {
        location: `steam://connect/${params.ip}`,
      },
    });
  },
  "/deployment-id": () => {
    return json({ deploymentId: Deno.env.get("DENO_DEPLOYMENT_ID") as string });
  },
  "/": () => {
    return json({ ping: "pong" });
  },
  404: ({ url, referrer }) => {
    instanceLog.info("404 Not found", { url, referrer });
    return json({ message: "Not Found" });
  },
});
