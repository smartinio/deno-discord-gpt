import {
  ImageMagick,
  initializeImageMagick,
  MagickGeometry,
} from "https://deno.land/x/imagemagick_deno@0.0.26/mod.ts";

await initializeImageMagick();

export const resizeImage = (
  imageBuffer: Uint8Array,
  { width, height }: { width: number; height: number },
) => {
  const sizingData = new MagickGeometry(width, height);

  sizingData.ignoreAspectRatio = height > 0 && width > 0;

  return new Promise<Uint8Array>((resolve) => {
    ImageMagick.read(imageBuffer, (image) => {
      image.resize(sizingData);
      image.write(resolve);
    });
  });
};
