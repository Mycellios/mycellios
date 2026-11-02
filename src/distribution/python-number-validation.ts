export function boundedInteger(value: unknown, min: number, max: number, error: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(error);
  }
  return value as number;
}

export function positiveFinite(value: unknown, error: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(error);
  }
  return value;
}

export function nonNegativeFinite(value: unknown, error: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(error);
  }
  return value;
}
