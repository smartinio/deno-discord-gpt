import { fileTypeFromBuffer } from "https://esm.sh/file-type";
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
  const res = await fetch(url);
  const buf = await res.arrayBuffer();

  return new File(
    [buf],
    url.split("/").at(-1) ?? "image.jpeg",
    { type: res.headers.get("content-type") ?? "image/jpeg" },
  );
};

const baseUrl = Deno.env.get("BASE_URL") || "http://localhost:8000";

export const saveGeneratedImage = async (b64: string) => {
  const mime = await detectImageMime(b64);

  if (!mime || !mime.startsWith("image/")) {
    throw new Error("Failed to detect mime type");
  }

  const id = crypto.randomUUID() + mime.replace("image/", ".");

  await redis.set(`generated-image:${id}`, `data:${mime};base64,${b64}`, {
    ex: 60 * 60 * 12, /* 12h */
  });

  return { mime, url: `${baseUrl}/generated-image/${id}` };
};

export const fetchGeneratedImage = async (id: string) => {
  const image = await redis.get<string>(`generated-image:${id}`);

  if (!image) {
    return null;
  }

  const mime = image.replace(/^data:([^;]+);.*$/, "$1");
  const base64 = image.replace(/^.*base64,(.*)$/, "$1");

  return { mime, base64 };
};

const base64ToBytes = (b64: string) => {
  const binary = atob(b64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

export const detectImageMime = async (base64Payload: string) => {
  const bytes = base64ToBytes(base64Payload);
  const result = await fileTypeFromBuffer(bytes);
  return result?.mime;
};
