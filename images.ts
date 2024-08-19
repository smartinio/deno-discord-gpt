import {
  ImageMagick,
  initializeImageMagick,
  MagickGeometry,
} from "https://deno.land/x/imagemagick_deno@0.0.26/mod.ts";

await initializeImageMagick();

export const resizeImage = (
  imageBuffer: ArrayBuffer,
  { width, height }: { width: number; height: number },
) => {
  const uint8array = new Uint8Array(imageBuffer);
  const sizingData = new MagickGeometry(width, height);

  sizingData.ignoreAspectRatio = height > 0 && width > 0;

  return new Promise<Uint8Array>((resolve) => {
    ImageMagick.read(uint8array, (image) => {
      image.resize(sizingData);
      image.write(resolve);
    });
  });
};

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
