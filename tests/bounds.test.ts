import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialTiles, fitZoom, locationInTile, subdivideTile } from '../src/bounds.js';

test('creates a north-to-south coarse grid with automatic zoom', () => {
  const tiles = createInitialTiles({ minLatitude: 0, minLongitude: 0, maxLatitude: 2, maxLongitude: 4 }, 1, 2);
  assert.deepEqual(tiles.map((tile) => tile.id), ['r1c1', 'r1c2']);
  assert.deepEqual(tiles[0].bounds, { minLatitude: 0, minLongitude: 0, maxLatitude: 2, maxLongitude: 2 });
  assert.equal(tiles[0].center.latitude, 1);
  assert.equal(tiles[0].center.longitude, 1);
  assert.ok(Number.isInteger(tiles[0].zoom));
});

test('subdivision halves the area and increases or preserves zoom', () => {
  const parent = createInitialTiles({ minLatitude: 37, minLongitude: -123, maxLatitude: 38, maxLongitude: -122 }, 1, 1)[0];
  const children = subdivideTile(parent);
  assert.equal(children.length, 4);
  assert.ok(children.every((child) => child.parentId === parent.id));
  assert.ok(children.every((child) => child.zoom >= parent.zoom));
});

test('fitZoom changes with geographic extent and locationInTile converts image coordinates', () => {
  const broad = fitZoom({ minLatitude: 0, minLongitude: 0, maxLatitude: 1, maxLongitude: 1 });
  const narrow = fitZoom({ minLatitude: 0, minLongitude: 0, maxLatitude: 0.01, maxLongitude: 0.01 });
  assert.ok(narrow > broad);
  const tile = createInitialTiles({ minLatitude: 10, minLongitude: 20, maxLatitude: 12, maxLongitude: 24 }, 1, 1)[0];
  assert.deepEqual(locationInTile(tile, { x: 0, y: 0 }), { latitude: 12, longitude: 20 });
  assert.deepEqual(locationInTile(tile, { x: 1, y: 1 }), { latitude: 10, longitude: 24 });
});