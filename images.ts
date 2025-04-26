import { redis } from "./redis.ts";

export const fetchImageBlob = async (url: string) => {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();

  return new Blob([arrayBuffer], {
    type: response.headers.get("content-type") ?? undefined,
  });
};

export const resolveImage = async (url: string) => {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  let binaryString = "";

  const chunkSize = 0x8000; // Arbitrary chunk size to avoid call stack issues

  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    binaryString += String.fromCharCode(
      ...uint8Array.subarray(i, i + chunkSize),
    );
  }

  return btoa(binaryString);
};

export const resolveImageAsFile = async (url: string) => {
  const imageBase64 = await resolveImage(url);

  return new File([atob(imageBase64)], "image.jpeg", {
    type: "image/jpeg",
  });
};

const baseUrl = Deno.env.get("BASE_URL") || "http://localhost:8000";

export const saveGeneratedImage = async (b64: string) => {
  const id = crypto.randomUUID() + ".jpeg";

  await redis.set(`generated-image:${id}`, b64, {
    ex: 60 * 60 * 12, /* 12h */
  });

  return `${baseUrl}/generated-image/${id}`;
};

export const fetchGeneratedImage = async (id: string) => {
  return await redis.get<string>(`generated-image:${id}`);
};
