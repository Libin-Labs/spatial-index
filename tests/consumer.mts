import { createSpatialIndex, type Bounds } from '@lp-labs/spatial-index';
const index = createSpatialIndex({ cellSize: 10 });
const bounds: Bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
index.upsert({ id: 'box', bounds });
void index.search(bounds);
