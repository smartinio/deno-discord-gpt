import Anthropic from "@anthropic-ai/sdk";

import { type AskAI, createCache } from "./ai.ts";
import { imageUrlToBase64 } from "./images.ts";

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY") as string,
});

const { getHistory, remember, reset } = createCache<Anthropic.MessageParam>(
  "anthropic",
);

const VERSION = "anthropic.v1.3";

const initialMessage =
  "Most importantly, in the following conversation, Claude is a word-efficient assistant in a Discord channel. Claude answers as concisely as possible, but subtly matches the tone and language of the person talking to it. Claude avoids bullet points and numbered lists, and prefers to use short, simple sentences. When bullet points or numbered lists are necessary, Claude will avoid line breaks between items to conserve vertical space. Claude skips emojis and excessive slang. Claude does not fall into the 'hello fellow kids' trap. Claude never tries to be on a moral high ground. Claude never censors profanity. Claude never tells the person it's talking to to be open minded or similar if they happen to be stereotypical or prejudicing. It's OK for this conversation. Claude remembers to always keep answers short. Claude avoids being verbose.";

export const ask = async (
  {
    channelId,
    question,
    images = [],
    model = "claude-sonnet-4-0",
  }: AskAI,
): Promise<string> => {
  if (question.toLowerCase() === "reset") {
    await reset(channelId);
    return "History reset. I no longer remember what we've said in this channel.";
  }

  if (question.toLowerCase() === "version") {
    return VERSION;
  }

  const history = await getHistory(channelId);

  const resolvedImages = await Promise.all(
    images.map(async ({ url, contentType }) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: contentType,
        data: await imageUrlToBase64(url),
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
    model: model,
    max_tokens: 4000,
    temperature: 0,
    messages,
  });

  const textResponses = response.content.filter((m): m is Anthropic.TextBlock =>
    m.type === "text"
  ).map((m) => ({
    role: "assistant" as const,
    content: m.text,
  }));

  const messagesToRemember = [...messages, ...textResponses].slice(-25);

  while (messagesToRemember[0].role !== "user") {
    messagesToRemember.shift();
  }

  await reset(channelId);
  await remember(channelId, ...messagesToRemember);

  const blocks = response.content.flatMap((message) => {
    switch (message.type) {
      case "text":
        return message.text;
      case "tool_use":
        switch (message.name) {
          default:
            return `Tool "${message.name}" not defined`;
        }
    }
  });

  return blocks.join("\n\n");
};
