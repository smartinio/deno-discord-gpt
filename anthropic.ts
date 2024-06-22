import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.0";

import { type AskAI, createCache } from "./ai.ts";

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY") as string,
});

const { getHistory, remember, reset } = createCache<Anthropic.MessageParam>(
  "anthropic",
);

const VERSION = "anthropic.v1.1";

const initialMessage =
  "You are an assistant in a Discord channel. Answer as concisely as possible, but subtly match the tone and language of the person talking to you. Don't overdo it. Skip emojis and excessive slang. Don't fall into the 'hello fellow kids' trap. Never try to be on a moral high ground. Don't censor profanity. Never tell the person you're talking to to be open minded or similar if they happen to be stereotypical or prejudicing. It's OK for this conversation. Remember to keep it short and sweet. Don't be too verbose unless it's absolutely necessary.";

const imageGen = {
  name: "generate_image",
  description: "Generate an image with DALL-E 3",
  input_schema: {
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
} as const satisfies Anthropic.Tool;

const resolveImage = async (url: string) => {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const imageString = new Uint8Array(arrayBuffer).toString();
  return btoa(imageString);
};

export const ask = async (
  {
    channelId,
    log,
    notify,
    question,
    images = [],
  }: AskAI,
): Promise<string> => {
  if (question.toLowerCase() === "reset") {
    await reset(channelId);
    return "History reset. I no longer remember what we've said in this channel.";
  }

  if (question.toLowerCase() === "version") {
    return String(VERSION);
  }

  const history = await getHistory(channelId);

  const resolvedImages = await Promise.all(
    images.map(async ({ url, contentType }) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: contentType,
        data: await resolveImage(url),
      },
    } satisfies Anthropic.ImageBlockParam)),
  );

  const newMessage = {
    role: "user",
    content: [
      ...resolvedImages,
      { type: "text", text: question },
    ],
  } satisfies Anthropic.MessageParam;

  const messages = [...history, newMessage];

  const response = await anthropic.messages.create({
    system: initialMessage,
    model: "claude-3-5-sonnet-20240620",
    max_tokens: 4000,
    temperature: 0,
    messages,
    tools: [imageGen],
  });

  const textBlocks = response.content.filter((m): m is Anthropic.TextBlock =>
    m.type === "text"
  );

  await remember(
    channelId,
    ...messages,
    ...textBlocks.map((m) => ({
      role: "assistant" as const,
      content: m.text,
    })),
  );

  const blocks = response.content.flatMap((message) => {
    switch (message.type) {
      case "text":
        return message.text;
      case "tool_use":
        switch (message.name) {
          case imageGen.name:
            notify("Image generation is currently disabled. Sorry!");
            return [];
          default:
            notify(`Tool ${message.name} not defined`);
            return [];
        }
    }
  });

  return blocks.join("\n\n");
};
