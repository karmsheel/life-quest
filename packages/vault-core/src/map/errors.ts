import type { DomainError, DomainErrorCode, Result } from "./types.ts";

export function fail(code: DomainErrorCode, message: string): Result<never> {
  const error: DomainError = { code, message };
  return { ok: false, error };
}

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
