export interface RetryOptions {
  retries?: number;
  minDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  work: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const retries = options.retries ?? 2;
  const minDelayMs = options.minDelayMs ?? 300;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        break;
      }

      // Exponential backoff to avoid hammering OSS or remote sources.
      const delayMs = minDelayMs * Math.pow(2, attempt);
      await sleep(delayMs);
    }
  }

  throw lastError;
}
