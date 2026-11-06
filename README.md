# @lp-labs/spatial-index

A deterministic two-dimensional uniform-grid index for axis-aligned rectangle intersection
queries. It is dependency-free and keeps a bounded number of grid memberships.

## Install

```bash
npm install @lp-labs/spatial-index
```

ES2022 ESM/CommonJS builds and TypeScript declarations are included. CommonJS:
`const { createSpatialIndex } = require('@lp-labs/spatial-index')`.

## Quickstart

```js
import { createSpatialIndex } from '@lp-labs/spatial-index';

const index = createSpatialIndex({ cellSize: 10 });
index.upsert({ id: 'parcel', bounds: { minX: 2, minY: 3, maxX: 14, maxY: 18 } });
const hits = index.search({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
console.log(hits.map((item) => item.id)); // ['parcel']
```

## API

- `createSpatialIndex(options?)` configures `cellSize` (default 100), `maxItems` (100,000),
  `maxCellsPerItem` (4,096), `maxCellsPerQuery` (65,536), and `maxCellEntries` (1,000,000).
- `upsert({ id, bounds })` inserts/replaces an item with finite ordered `{ minX, minY, maxX,
maxY }` coordinates. IDs are strings up to 256 characters.
- `search(bounds)` returns detached item snapshots intersecting the inclusive rectangle, sorted by
  ID. Queries exceeding the configured cell count fail with `SpatialIndexError` code
  `query-too-large`.
- `remove(id)`, `clear()`, and `size` provide lifecycle and count operations.

Items that span more than `maxCellsPerItem` are kept in a bounded overflow list and checked
against each query, rather than silently omitted. Exceeding item or grid-membership capacity
throws `SpatialIndexError` code `capacity`; failed replacements preserve the previous item.

## Customization and limitations

Choose `cellSize` based on expected object/query dimensions: small cells reduce candidate checks
but increase memberships; large cells do the opposite. The grid supports Cartesian 2D
axis-aligned boxes only, not geodesic distance, coordinate reference systems, polygons,
nearest-neighbor search, 3D geometry, persistence, or concurrent mutation. Search performance
can degrade for dense cells or many overflow objects; it is not an R-tree.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
