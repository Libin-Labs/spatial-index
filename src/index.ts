export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SpatialIndexOptions {
  cellSize?: number;
  maxItems?: number;
  maxCellsPerItem?: number;
  maxCellsPerQuery?: number;
  maxCellEntries?: number;
}

export interface SpatialItem {
  id: string;
  bounds: Bounds;
}

export interface SpatialIndex {
  readonly size: number;
  upsert(item: SpatialItem): void;
  remove(id: string): boolean;
  search(bounds: Bounds): SpatialItem[];
  clear(): void;
}

export class SpatialIndexError extends Error {
  constructor(
    readonly code: 'capacity' | 'query-too-large',
    message: string,
  ) {
    super(message);
    this.name = 'SpatialIndexError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

function assertPlainObject(value: unknown, name: string): void {
  if (!isRecord(value)) throw new TypeError(`${name} must be a plain object.`);
}

function integer(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 1 through ${maximum}.`);
  }
  return value;
}

function validateBounds(input: unknown): Bounds {
  if (!isRecord(input)) throw new TypeError('Bounds must be a plain object.');
  const { minX, minY, maxX, maxY } = input;
  if (
    ![minX, minY, maxX, maxY].every((value) => typeof value === 'number' && Number.isFinite(value))
  ) {
    throw new TypeError('Bounds coordinates must be finite numbers.');
  }
  if ((minX as number) > (maxX as number) || (minY as number) > (maxY as number)) {
    throw new RangeError('Bounds minima must not exceed maxima.');
  }
  return Object.freeze({
    minX: minX as number,
    minY: minY as number,
    maxX: maxX as number,
    maxY: maxY as number,
  });
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function createSpatialIndex(options: SpatialIndexOptions = {}): SpatialIndex {
  assertPlainObject(options, 'Options');
  const cellSize = options.cellSize ?? 100;
  if (typeof cellSize !== 'number' || !Number.isFinite(cellSize) || cellSize <= 0) {
    throw new RangeError('cellSize must be a positive finite number.');
  }
  const maxItems = integer(options.maxItems ?? 100_000, 'maxItems', 1_000_000);
  const maxCellsPerItem = integer(options.maxCellsPerItem ?? 4096, 'maxCellsPerItem', 1_000_000);
  const maxCellsPerQuery = integer(
    options.maxCellsPerQuery ?? 65_536,
    'maxCellsPerQuery',
    1_000_000,
  );
  const maxCellEntries = integer(options.maxCellEntries ?? 1_000_000, 'maxCellEntries', 10_000_000);
  const items = new Map<string, { bounds: Bounds; cells: string[]; overflow: boolean }>();
  const cells = new Map<string, Set<string>>();
  let memberships = 0;

  function validateId(id: unknown): asserts id is string {
    if (typeof id !== 'string' || id.length === 0 || id.length > 256) {
      throw new TypeError('Item id must be a non-empty string of at most 256 characters.');
    }
  }
  const cellRange = (
    bounds: Bounds,
  ): { minX: number; maxX: number; minY: number; maxY: number; count: number } => {
    const minX = Math.floor(bounds.minX / cellSize);
    const maxX = Math.floor(bounds.maxX / cellSize);
    const minY = Math.floor(bounds.minY / cellSize);
    const maxY = Math.floor(bounds.maxY / cellSize);
    if (![minX, maxX, minY, maxY].every(Number.isSafeInteger)) {
      throw new RangeError('Bounds coordinates exceed the supported grid coordinate range.');
    }
    const count = (maxX - minX + 1) * (maxY - minY + 1);
    if (!Number.isSafeInteger(count))
      throw new SpatialIndexError('query-too-large', 'Bounds cover too many grid cells.');
    return { minX, maxX, minY, maxY, count };
  };
  const keysFor = (bounds: Bounds, maximum: number): string[] | undefined => {
    const range = cellRange(bounds);
    if (range.count > maximum) return undefined;
    const keys: string[] = [];
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) keys.push(`${x},${y}`);
    }
    return keys;
  };
  const detach = (id: string, item: { cells: string[]; overflow: boolean }) => {
    if (item.overflow) return;
    for (const key of item.cells) {
      const entries = cells.get(key)!;
      entries.delete(id);
      memberships--;
      if (entries.size === 0) cells.delete(key);
    }
  };

  return {
    get size() {
      return items.size;
    },
    upsert(input) {
      if (!isRecord(input)) throw new TypeError('Item must be a plain object.');
      validateId(input.id);
      const bounds = validateBounds(input.bounds);
      const keys = keysFor(bounds, maxCellsPerItem);
      const overflow = keys === undefined;
      const previous = items.get(input.id);
      if (!previous && items.size >= maxItems)
        throw new SpatialIndexError('capacity', 'Spatial item capacity reached.');
      const oldMemberships = previous && !previous.overflow ? previous.cells.length : 0;
      const newMemberships = overflow ? 0 : keys.length;
      if (memberships - oldMemberships + newMemberships > maxCellEntries) {
        throw new SpatialIndexError('capacity', 'Spatial grid cell-entry capacity reached.');
      }
      if (previous) detach(input.id, previous);
      items.set(input.id, { bounds, cells: overflow ? [] : keys, overflow });
      if (!overflow && keys) {
        for (const key of keys) {
          let entries = cells.get(key);
          if (!entries) cells.set(key, (entries = new Set()));
          entries.add(input.id);
          memberships++;
        }
      }
    },
    remove(id) {
      validateId(id);
      const item = items.get(id);
      if (!item) return false;
      detach(id, item);
      items.delete(id);
      return true;
    },
    search(input) {
      const bounds = validateBounds(input);
      const keys = keysFor(bounds, maxCellsPerQuery);
      if (!keys)
        throw new SpatialIndexError(
          'query-too-large',
          `Bounds cover more than ${maxCellsPerQuery} grid cells.`,
        );
      const ids = new Set<string>();
      for (const key of keys) for (const id of cells.get(key) ?? []) ids.add(id);
      for (const [id, item] of items) if (item.overflow) ids.add(id);
      return [...ids]
        .filter((id) => intersects(items.get(id)!.bounds, bounds))
        .sort((a, b) => a.localeCompare(b, 'en'))
        .map((id) => ({ id, bounds: { ...items.get(id)!.bounds } }));
    },
    clear() {
      items.clear();
      cells.clear();
      memberships = 0;
    },
  };
}
