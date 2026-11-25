/**
 * Minimal types for Bun's built-in test runner, so `tsc --noEmit` can check
 * the `*.test.ts` files without adding `@types/bun` as a dependency. It only
 * declares what the unit tests use; if `@types/bun` is ever installed, delete
 * this file.
 */
declare module "bun:test" {
  interface MinimalMatchers {
    not: MinimalMatchers;
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeCloseTo(expected: number, numDigits?: number): void;
    toHaveLength(length: number): void;
  }

  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(actual: unknown): MinimalMatchers;
}
