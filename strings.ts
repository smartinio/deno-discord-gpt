export const chunkString = (str: string, maxChunkSize = 2000) => {
  const chunks = [];
  let start = 0;

  while (start < str.length) {
    // Determine the end of the chunk
    let end = start + maxChunkSize;

    // If end exceeds the string length, adjust it to the end of the string
    if (end >= str.length) {
      chunks.push(str.slice(start));
      break;
    }

    // If the character at the end index is not a whitespace, find the nearest whitespace before it
    if (str[end] !== " " && str[end] !== "\n" && str[end] !== "\t") {
      const lastDoubleNewline = str.lastIndexOf("\n\n", end);
      const lastSingleNewline = str.lastIndexOf("\n", end);
      const lastSpace = str.lastIndexOf(" ", end);

      if (lastDoubleNewline > start) {
        end = lastDoubleNewline;
      } else if (lastSingleNewline > start) {
        end = lastSingleNewline;
      } else if (lastSpace > start) {
        end = lastSpace;
      } else {
        // If no whitespace found, use the max chunk size (this case is rare)
        end = start + maxChunkSize;
      }
    }

    // Push the chunk to the array
    chunks.push(str.slice(start, end));

    // Move the start index to the end of the current chunk
    start = end + 1;
  }

  return chunks;
};
