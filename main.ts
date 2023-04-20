import { json, serve } from "https://deno.land/x/sift@0.6.0/mod.ts";
import { OpenAI } from "https://deno.land/x/openai@1.3.1/mod.ts";
import {
  createBot,
  Intents,
  startBot,
} from "https://deno.land/x/discordeno@13.0.0/mod.ts";

const BOT_ROLE_ID = 634461594155483138n;
const AI_CURIOUS_ROLE_ID = 1098370802526724206n;

const DISCORD_CLIENT_ID = BigInt(Deno.env.get("DISCORD_CLIENT_ID") as string);
const DISCORD_TOKEN = Deno.env.get("DISCORD_TOKEN") as string;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") as string;

const BOT_MENTION = `(${DISCORD_CLIENT_ID}|\&${BOT_ROLE_ID})`;
const initialMention = new RegExp(`^<@${BOT_MENTION}>[^A-Za-z0-9]*`);
const midwayMention = new RegExp(`<@${BOT_MENTION}>`);

const openAI = new OpenAI(OPENAI_API_KEY);

const ask = (question: string) => {
  return openAI.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: [
      {
        "role": "system",
        "content":
          "You are a helpful assistant. Answer as concisely as possible.",
      },
      { "role": "user", "content": question },
    ],
  });
};

const bot = createBot({
  botId: DISCORD_CLIENT_ID,
  token: DISCORD_TOKEN,
  intents: Intents.GuildMessages | Intents.MessageContent,
  events: {
    async messageCreate(bot, message) {
      if (!message.member?.roles?.includes(AI_CURIOUS_ROLE_ID)) {
        return;
      }

      if (
        !message.mentionedRoleIds.includes(BOT_ROLE_ID) &&
        !message.mentionedUserIds.includes(DISCORD_CLIENT_ID)
      ) {
        return;
      }

      bot.helpers.startTyping(message.channelId);

      const response = (content: string) => {
        return bot.helpers.sendMessage(message.channelId, {
          content: `<@${message.authorId}> ${content}`,
          messageReference: {
            ...message.messageReference,
            failIfNotExists: false,
          },
        });
      };

      if (!initialMention.test(message.content)) {
        return response(
          `Please @ me like this when asking a question: \`<@${bot.applicationId}> what is the meaning of life?\``,
        );
      }

      const nonBotMentions = message.mentionedUserIds.filter((id) => {
        return id !== DISCORD_CLIENT_ID;
      }).concat(message.mentionedRoleIds.filter((id) => {
        return id !== BOT_ROLE_ID;
      }));

      if (nonBotMentions.length > 0) {
        return response(
          "Don't @ anyone else when talking to me, please.",
        );
      }

      const question = message.content.replace(initialMention, "").trim();

      if (!question) {
        return response("Don't @ me unless you have a question.");
      }

      if (midwayMention.test(question)) {
        return response(
          "Don't @ me multiple times, please.",
        );
      }

      const answer = await ask(question);

      const [reply] = answer.choices;

      return response(reply.message.content);
    },
    ready() {
      console.log("Successfully connected to gateway");
    },
  },
});

await startBot(bot);

serve({
  "/ping": () => json({ message: "pong" }),
});
