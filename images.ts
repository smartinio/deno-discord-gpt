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
