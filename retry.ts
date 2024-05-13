export const retry = async <T>(
  fn: () => Promise<T>,
  { maxRetries = 3, delay = 500 }: { maxRetries?: number; delay?: number } = {},
) => {
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (retryCount === maxRetries - 1) {
        throw error;
      }

      retryCount++;

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
};
