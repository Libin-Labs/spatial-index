import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createSpatialIndex, SpatialIndexError } from '../dist/esm/index.js';

const require = createRequire(import.meta.url);
const box = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });

test('CommonJS build returns spatial matches', () => {
  const { createSpatialIndex: createCjsIndex } = require('../dist/cjs/index.js');
  const index = createCjsIndex();
  index.upsert({ id: 'cjs', bounds: box(0, 0, 1, 1) });
  assert.equal(index.search(box(1, 1, 2, 2))[0].id, 'cjs');
});

test('finds inclusive rectangle intersections and sorts by id', () => {
  const index = createSpatialIndex({ cellSize: 10 });
  index.upsert({ id: 'z', bounds: box(10, 10, 20, 20) });
  index.upsert({ id: 'a', bounds: box(20, 20, 30, 30) });
  index.upsert({ id: 'miss', bounds: box(31, 31, 40, 40) });
  assert.deepEqual(
    index.search(box(0, 0, 20, 20)).map(({ id }) => id),
    ['a', 'z'],
  );
});

test('negative coordinates map consistently to grid cells', () => {
  const index = createSpatialIndex({ cellSize: 5 });
  index.upsert({ id: 'negative', bounds: box(-10, -5, -1, 0) });
  assert.deepEqual(
    index.search(box(-6, -2, 1, 2)).map(({ id }) => id),
    ['negative'],
  );
});

test('updates remove old memberships and preserve snapshots', () => {
  const index = createSpatialIndex({ cellSize: 1 });
  index.upsert({ id: 'item', bounds: box(0, 0, 1, 1) });
  const result = index.search(box(0, 0, 1, 1));
  index.upsert({ id: 'item', bounds: box(20, 20, 21, 21) });
  assert.deepEqual(index.search(box(0, 0, 1, 1)), []);
  assert.equal(result[0].bounds.minX, 0);
  assert.deepEqual(
    index.search(box(20, 20, 21, 21)).map(({ id }) => id),
    ['item'],
  );
});

test('large items use the overflow path and remain searchable', () => {
  const index = createSpatialIndex({ cellSize: 1, maxCellsPerItem: 4 });
  index.upsert({ id: 'wide', bounds: box(0, 0, 100, 100) });
  assert.deepEqual(
    index.search(box(50, 50, 51, 51)).map(({ id }) => id),
    ['wide'],
  );
});

test('query cell bound and grid entry capacity fail explicitly', () => {
  const index = createSpatialIndex({ cellSize: 1, maxCellsPerQuery: 4, maxCellEntries: 2 });
  assert.throws(() => index.search(box(0, 0, 2, 2)), SpatialIndexError);
  index.upsert({ id: 'a', bounds: box(0, 0, 1, 0) });
  assert.throws(() => index.upsert({ id: 'b', bounds: box(0, 0, 1, 0) }), SpatialIndexError);
});

test('failed replacement preserves previous item', () => {
  const index = createSpatialIndex({ cellSize: 1, maxCellEntries: 1 });
  index.upsert({ id: 'a', bounds: box(0, 0, 0, 0) });
  assert.throws(() => index.upsert({ id: 'a', bounds: box(10, 10, 11, 11) }), SpatialIndexError);
  assert.deepEqual(
    index.search(box(0, 0, 0, 0)).map(({ id }) => id),
    ['a'],
  );
});

test('remove, clear, and capacity reuse work correctly', () => {
  const index = createSpatialIndex({ maxItems: 1 });
  index.upsert({ id: 'a', bounds: box(0, 0, 1, 1) });
  assert.equal(index.remove('a'), true);
  assert.equal(index.remove('a'), false);
  index.upsert({ id: 'b', bounds: box(0, 0, 1, 1) });
  index.clear();
  assert.equal(index.size, 0);
});

test('validates bounds, IDs, options, and finite coordinates', () => {
  assert.throws(() => createSpatialIndex({ cellSize: 0 }), RangeError);
  const index = createSpatialIndex();
  assert.throws(() => index.upsert({ id: '', bounds: box(0, 0, 1, 1) }), TypeError);
  assert.throws(() => index.upsert({ id: 'bad', bounds: box(1, 0, 0, 1) }), RangeError);
  assert.throws(() => index.search(box(0, 0, Infinity, 1)), TypeError);
});

test('rejects grid coordinates outside the safe integer range', () => {
  const index = createSpatialIndex({ cellSize: 1 });
  assert.throws(() => index.search(box(1e20, 1e20, 1e20, 1e20)), RangeError);
});

test('cell boundaries and zero-area points are included', () => {
  const index = createSpatialIndex({ cellSize: 10 });
  index.upsert({ id: 'point', bounds: box(10, 10, 10, 10) });
  assert.deepEqual(
    index.search(box(10, 10, 10, 10)).map(({ id }) => id),
    ['point'],
  );
});

test('generated search results match a brute-force rectangle oracle', () => {
  const index = createSpatialIndex({ cellSize: 7, maxItems: 500, maxCellsPerItem: 100 });
  const entries = [];
  for (let i = 0; i < 250; i++) {
    const x = ((i * 37) % 151) - 75;
    const y = ((i * 61) % 151) - 75;
    const width = (i * 7) % 9;
    const height = (i * 11) % 9;
    const bounds = box(x, y, x + width, y + height);
    entries.push({ id: `i${i}`, bounds });
    index.upsert({ id: `i${i}`, bounds });
  }
  for (let q = 0; q < 80; q++) {
    const x = ((q * 19) % 130) - 65;
    const y = ((q * 31) % 130) - 65;
    const query = box(x, y, x + (q % 17), y + (q % 13));
    const expected = entries
      .filter(
        ({ bounds }) =>
          bounds.minX <= query.maxX &&
          bounds.maxX >= query.minX &&
          bounds.minY <= query.maxY &&
          bounds.maxY >= query.minY,
      )
      .map(({ id }) => id)
      .sort();
    assert.deepEqual(
      index.search(query).map(({ id }) => id),
      expected,
    );
  }
});

test('many coincident objects remain complete without duplicate results', () => {
  const index = createSpatialIndex({ cellSize: 20, maxItems: 500 });
  for (let i = 0; i < 300; i++) index.upsert({ id: `x${i}`, bounds: box(0, 0, 20, 20) });
  assert.equal(index.search(box(2, 2, 3, 3)).length, 300);
});
