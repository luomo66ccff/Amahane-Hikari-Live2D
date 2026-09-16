// SPDX-License-Identifier: MIT
/**
 * Bound waiting and release the timer/listener on every settlement path.
 * This does not cancel the underlying operation: its owner must release its
 * resources (the texture loader clears img.src and revokes its URL in finally).
 * A late operation rejection is still consumed after timeout or abort.
 */
export function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  message: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      reject(new RangeError('timeoutMs must be finite and positive'));
      return;
    }
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = (reason: unknown): void => {
      cleanup();
      reject(reason);
    };
    const onAbort = (): void => fail(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => fail(new Error(message)), timeoutMs);
    try {
      operation().then(value => { cleanup(); resolve(value); }, fail);
    } catch (error) {
      fail(error);
    }
  });
}
