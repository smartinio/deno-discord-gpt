import {
  ResponseInput,
  ResponseInputImage,
} from "https://jsr.io/@openai/openai/4.96.0/resources/responses/responses.ts";
import {
  ImagesResponse,
} from "https://jsr.io/@openai/openai/4.96.0/resources.ts";

import { AskAI } from "./ai.ts";
import { lock, redis } from "./redis.ts";
import { OpenAI } from "@openai/openai";
import { Log } from "./logger.ts";
import { saveGeneratedImage } from "./images.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") as string;

const openAI = new OpenAI({
  apiKey: OPENAI_API_KEY,
  maxRetries: 3,
});

const getLastResponseId = async (channelId: bigint) => {
  return await redis.get<string>(`openai:last_response_id:${channelId}`);
};

const setLastResponseId = async (channelId: bigint, responseId: string) => {
  return await redis.set(`openai:last_response_id:${channelId}`, responseId);
};

const systemPrompt =
  "You are an assistant in a Discord channel. Answer as concisely as possible, but match the tone and language of the person talking to you. Don't overdo it. Skip emojis and excessive slang. Never try to be on a moral high ground. Don't censor profanity. Never tell the person you're talking to to be open minded or similar if they happen to be stereotypical or prejudicing - it's OK for this conversation.";

const openai_images_generate = {
  type: "function",
  name: "openai_images_generate",
  description: "Generate an image with GPT Image 1",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  strict: true,
} as const;

const validateGenerateImageArguments = (
  data: unknown,
): data is { prompt: string } => {
  return data !== null && typeof data === "object" && "prompt" in data &&
    typeof data.prompt === "string";
};

const generateImage = async ({
  stringArgs,
  log,
  notify,
}: {
  stringArgs: string;
  log: Log;
  notify: (message: string) => void;
}): Promise<{ error: string } | { result: ImagesResponse }> => {
  const args = JSON.parse(stringArgs);

  if (!validateGenerateImageArguments(args)) {
    log.error("Invalid arguments from OpenAI", { args });

    return { error: "Sorry, couldn't generate your image. Please try again." };
  }

  const { prompt } = args;

  log.info("Generating image", { prompt });

  notify("Generating image. Might take a while...");

  return {
    result: await openAI.images.generate({
      prompt,
      model: "gpt-image-1",
      quality: "medium",
      n: 1,
    }),
  };
};

export const ask = async ({
  question,
  channelId,
  log,
  images = [],
  notify,
}: AskAI): Promise<string | { answer: string; imageUrl?: string }> => {
  return await lock(channelId, async () => {
    const lastResponseId = await getLastResponseId(channelId) || undefined;

    const input: ResponseInput = [];

    if (!lastResponseId) {
      input.push({
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }],
      });
    }

    input.push({
      role: "user",
      content: [
        { type: "input_text", text: question },
        ...(images.map(({ url }): ResponseInputImage => (
          {
            type: "input_image",
            image_url: url,
            detail: "low",
          }
        ))),
      ],
    });

    log.info("Debug", { lastResponseId, channelId });

    const response = await openAI.responses.create({
      model: "o3",
      input,
      store: true,
      previous_response_id: lastResponseId,
      tool_choice: "auto",
      tools: [
        openai_images_generate,
      ],
    });

    if (response.error) {
      log.error("OpenAI error", { response });
      return "Sorry, something went wrong. Please try again.";
    }

    const functionCall = response.output.find((item) =>
      item.type === "function_call"
    );

    let imageUrl: string | undefined;

    if (functionCall?.name === "openai_images_generate") {
      const imageResponse = await generateImage({
        stringArgs: functionCall.arguments,
        log,
        notify,
      });

      if ("error" in imageResponse) {
        return {
          answer: imageResponse.error,
        };
      }

      log.info("Image generated", { result: imageResponse.result });

      const b64 = imageResponse.result.data?.[0].b64_json;

      if (!b64) {
        log.error("Failed to generate image", { result: imageResponse.result });

        return {
          answer: "Sorry, the image could not be generated. Please try again.",
        };
      }

      imageUrl = await saveGeneratedImage(b64);
    }

    await setLastResponseId(channelId, response.id);

    return {
      answer: response.output_text,
      imageUrl,
    };
  });
};
