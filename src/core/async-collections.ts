/** Await database-backed collection operations in the original iteration order. */
export async function mapAsync<T, U>(items: readonly T[], operation: (value: T, index: number, items: readonly T[]) => U | PromiseLike<U>, thisArg?: unknown): Promise<Awaited<U>[]> {
  const length = items.length;
  const result = new Array<Awaited<U>>(length);
  for (let index = 0; index < length; index++) {
    if (index in items) result[index] = await operation.call(thisArg, items[index]!, index, items);
  }
  return result;
}

export async function forEachAsync<T>(items: readonly T[], operation: (value: T, index: number, items: readonly T[]) => unknown, thisArg?: unknown): Promise<void> {
  const length = items.length;
  for (let index = 0; index < length; index++) {
    if (index in items) await operation.call(thisArg, items[index]!, index, items);
  }
}

export async function flatMapAsync<T, U>(items: readonly T[], operation: (value: T, index: number, items: readonly T[]) => U | readonly U[] | PromiseLike<U | readonly U[]>, thisArg?: unknown): Promise<Awaited<U>[]> {
  const length = items.length;
  const result: Awaited<U>[] = [];
  for (let index = 0; index < length; index++) {
    if (!(index in items)) continue;
    const value = await operation.call(thisArg, items[index]!, index, items);
    if (Array.isArray(value)) {
      for (let nested = 0; nested < value.length; nested++) {
        if (nested in value) result.push(value[nested] as Awaited<U>);
      }
    } else result.push(value as Awaited<U>);
  }
  return result;
}

export async function filterAsync<T>(items: readonly T[], predicate: (value: T, index: number, items: readonly T[]) => unknown, thisArg?: unknown): Promise<T[]> {
  const length = items.length;
  const result: T[] = [];
  for (let index = 0; index < length; index++) {
    if (index in items && await predicate.call(thisArg, items[index]!, index, items)) result.push(items[index]!);
  }
  return result;
}

export async function findAsync<T>(items: readonly T[], predicate: (value: T, index: number, items: readonly T[]) => unknown, thisArg?: unknown): Promise<T | undefined> {
  const length = items.length;
  for (let index = 0; index < length; index++) {
    if (await predicate.call(thisArg, items[index]!, index, items)) return items[index];
  }
  return undefined;
}

export async function someAsync<T>(items: readonly T[], predicate: (value: T, index: number, items: readonly T[]) => unknown, thisArg?: unknown): Promise<boolean> {
  const length = items.length;
  for (let index = 0; index < length; index++) {
    if (index in items && await predicate.call(thisArg, items[index]!, index, items)) return true;
  }
  return false;
}

export async function everyAsync<T>(items: readonly T[], predicate: (value: T, index: number, items: readonly T[]) => unknown, thisArg?: unknown): Promise<boolean> {
  const length = items.length;
  for (let index = 0; index < length; index++) {
    if (index in items && !await predicate.call(thisArg, items[index]!, index, items)) return false;
  }
  return true;
}

export async function reduceAsync<T, U>(items: readonly T[], operation: (accumulator: U, value: T, index: number, items: readonly T[]) => U | PromiseLike<U>, initialValue: U): Promise<Awaited<U>> {
  const length = items.length;
  let accumulator = initialValue;
  for (let index = 0; index < length; index++) {
    if (index in items) accumulator = await operation(accumulator, items[index]!, index, items);
  }
  return await accumulator;
}
