import { createSpatialIndex } from '@lp-labs/spatial-index';
const index = createSpatialIndex();
index.upsert({ id: 'box', bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } });
const size: number = index.size;
void size;
