import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialTiles } from '../src/bounds.js';
import { createSatelliteImageUrl, GoogleStaticMapsSatelliteClient } from '../src/google-static-maps.js';

test('builds an automatic-zoom satellite Static Maps URL', () => {
  const tile = createInitialTiles({ minLatitude: 37, minLongitude: -123, maxLatitude: 38, maxLongitude: -122 }, 1, 1)[0];
  const url = new URL(createSatelliteImageUrl(tile, { apiKey: 'test-key' }));
  assert.equal(url.searchParams.get('maptype'), 'satellite');
  assert.equal(url.searchParams.get('size'), '640x640');
  assert.equal(url.searchParams.get('scale'), '2');
  assert.equal(url.searchParams.get('zoom'), String(tile.zoom));
  assert.equal(url.searchParams.get('key'), 'test-key');
});

test('returns PNG bytes and rejects non-image API responses', async () => {
  const tile = createInitialTiles({ minLatitude: 0, minLongitude: 0, maxLatitude: 1, maxLongitude: 1 }, 1, 1)[0];
  const client = new GoogleStaticMapsSatelliteClient({
    apiKey: 'test-key',
    fetchImpl: async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } }),
  });
  const image = await client.fetch(tile);
  assert.equal(image.mimeType, 'image/png');
  assert.deepEqual([...image.bytes], [137, 80, 78, 71]);
  const failing = new GoogleStaticMapsSatelliteClient({
    apiKey: 'test-key',
    fetchImpl: async () => new Response('bad key', { status: 403, headers: { 'content-type': 'text/plain' } }),
  });
  await assert.rejects(() => failing.fetch(tile), /HTTP 403: bad key/u);
});