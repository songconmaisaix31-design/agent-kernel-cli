// Adapted from Orca kernel-run-limits.ts at 01bd406; MIT, see README and LICENSE.
export function parseLimits(input: unknown = {}): { timeoutMs: number; outputLimitBytes: number } {
  const defaults = { timeoutMs: 120_000, outputLimitBytes: 8 * 1024 * 1024 };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Limits must be finite positive integers with known names.');
  }
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(defaults, key) || typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
      throw new Error('Limits must be finite positive integers with known names.');
    }
  }
  const limits = { ...defaults, ...input };
  if (limits.timeoutMs > 900_000 || limits.outputLimitBytes > 64 * 1024 * 1024) {
    throw new Error('Maximum timeout is 900000 ms; maximum output limit is 64 MiB.');
  }
  return limits;
}
