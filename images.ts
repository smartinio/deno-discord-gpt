import { fileTypeFromBuffer } from "https://esm.sh/file-type";
import { redis } from "./redis.ts";
import {
  decodeBase64,
  encodeBase64,
} from "https://deno.land/std@0.224.0/encoding/base64.ts";

export const fetchImageBlob = async (url: string) => {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();

  return new Blob([arrayBuffer], {
    type: response.headers.get("content-type") ?? undefined,
  });
};

export const imageUrlToBase64 = async (url: string) => {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();

  return encodeBase64(arrayBuffer);
};

export const imageUrlToFile = async (url: string) => {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();

  return new File([arrayBuffer], new URL(url).pathname.split("/").at(-1)!, {
    type: response.headers.get("content-type")!,
  });
};

export const savedImageToFile = async (
  key: string,
): Promise<File | null> => {
  const image = await fetchSavedImage(key);

  if (!image) {
    return null;
  }

  const buf = decodeBase64(image.base64);

  return new File([buf], key, { type: image.mime });
};

export const saveImage = async (b64: string) => {
  const mime = await detectImageMime(b64);

  if (!mime || !mime.startsWith("image/")) {
    throw new Error("Failed to detect mime type");
  }

  const key = crypto.randomUUID() + mime.replace("image/", ".");

  await redis.set(`image:${key}`, `data:${mime};base64,${b64}`, {
    ex: 60 * 60 * 12, /* 12h */
  });

  return { mime, key };
};

export const fetchSavedImage = async (key: string) => {
  const image = await redis.get<string>(`image:${key}`);

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
