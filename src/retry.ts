/**
 * Upstream calls fail and rate-limit in production; the brief asks for every
 * stage to be retryable. This is the minimal version: bounded attempts with
 * exponential backoff and jitter, retrying only what is plausibly transient.
 */

export class UpstreamError extends Error {
  readonly service: string;
  readonly status: number;
  // Explicit fields rather than constructor parameter properties: Node's
  // strip-only TypeScript mode cannot erase the shorthand, and tests run there.
  constructor(service: string, status: number, body: string) {
    super(`${service} ${status}: ${body.slice(0, 300)}`);
    this.name = "UpstreamError";
    this.service = service;
    this.status = status;
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof UpstreamError) return err.status === 429 || err.status >= 500;
  // fetch() rejects with a TypeError on network failure.
  return err instanceof TypeError;
}

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 400;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === attempts - 1) throw err;
      const delay = baseMs * 2 ** i + Math.random() * 200;
      console.warn(`${label}: attempt ${i + 1} failed, retrying in ${Math.round(delay)}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
