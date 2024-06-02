import { OpenAI } from "https://deno.land/x/openai@v4.28.4/mod.ts";

import { lock, redis } from "./redis.ts";
import { Log } from "./logger.ts";

import type {
  ChatCompletionCreateParams,
  ChatCompletionTool,
  ImagesResponse,
} from "https://deno.land/x/openai@v4.28.4/resources/mod.ts";

type Message = ChatCompletionCreateParams["messages"][number];

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

const VERSION = 22;

const openai_images_generate = {
  type: "function",
  function: {
    name: "openai_images_generate",
    description: "Generate an image with DALL-E 3",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
        },
        style: {
          type: "string",
          enum: ["vivid", "natural"],
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
} as const satisfies ChatCompletionTool;

const validateGenerateImageArguments = (
  data: unknown,
): data is { prompt: string; style: "vivid" | "natural" } => {
  return data !== null && typeof data === "object" && "prompt" in data &&
      "style" in data
    ? (data.style === "vivid" || data.style === "natural")
    : true;
};

export const ask = async ({
  question,
  channelId,
  log,
  imageUrls,
  notify,
}: {
  question: string;
  channelId: bigint;
  log: Log;
  imageUrls?: string[];
  notify: (message: string) => void;
}): Promise<string | { answer: string; imageUrl?: string }> => {
  return await lock(channelId, async () => {
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
                text: "[expired image link]",
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
      model: "gpt-4o",
      messages,
      tools: [openai_images_generate],
    });

    const [reply] = answer.choices;

    const toolCall = reply.message.tool_calls?.at(0);

    let imagesResponse: ImagesResponse | undefined;

    if (toolCall?.function.name === openai_images_generate.function.name) {
      const args = JSON.parse(toolCall.function.arguments);

      if (!validateGenerateImageArguments(args)) {
        log.error("Invalid arguments from OpenAI", { args });

        return "Sorry, couldn't generate your image. Please try again.";
      }

      const { prompt, style } = args;

      log.info("Generating image", {
        channelId: String(channelId),
        prompt,
        style,
      });

      notify("Generating image. Might take a while...");

      imagesResponse = await openAI.images.generate({
        prompt,
        model: "dall-e-3",
        quality: "hd",
        n: 1,
        style,
      });
    }

    log.info("Usage", { total_tokens: answer.usage?.total_tokens });

    let extra = "";

    if ((answer.usage?.total_tokens ?? 0) > 3500) {
      extra =
        "\n\nBy the way. My brain just reached its limit, so I forgot everything we talked about. I hope you understand... 💔";
      log.info("Reset due to usage", { ...answer.usage });
      await reset(channelId);
    } else if (!imagesResponse) {
      await remember(channelId, ...newMessages, reply.message);
    }

    if (imagesResponse) {
      return {
        imageUrl: imagesResponse.data[0].url,
        answer: extra,
      };
    }

    return (reply.message.content ?? "No response from OpenAI 🤷‍♂️") + extra;
  });
};
