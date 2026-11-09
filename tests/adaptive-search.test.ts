import assert from 'node:assert/strict';
import test from 'node:test';
import type { ILlmProvider, LlmRequest, LlmResponse } from 'llm';
import { searchArea } from '../src/adaptive-search.js';
import type { SatelliteImageClient } from '../src/types.js';

const response = (score: number): LlmResponse => ({
  schema: 'https://schemas.handschuh.dev/llm/response/v1',
  status: 'success',
  output: {
    $type: 'object',
    schema: { name: 'assessment' },
    value: {
      match: score >= 0.5,
      score,
      reason: 'The tile is consistent with the description.',
      relativeLocation: { x: 0.25, y: 0.75 },
    },
  },
  failedAttempts: 0,
  iterations: 1,
  errors: [],
});

test('refines only the strongest coarse tile and uses image/png base64 files', async () => {
  const requests: LlmRequest[] = [];
  const configurationRoots: string[] = [];
  const imagery: SatelliteImageClient = {
    async fetch(tile) {
      return { tile, mimeType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) };
    },
  };
  const llm: ILlmProvider = {
    async complete(request, options) {
      requests.push(request);
      configurationRoots.push(options?.configurationRoot ?? '');
      const task = JSON.parse(request.task) as { tile: { id: string; depth: number } };
      return response(task.tile.id === 'r1c1' ? 0.9 : task.tile.depth === 1 ? 0.8 : 0.2);
    },
  };
  const result = await searchArea(
    { description: 'a circular clearing', area: { minLatitude: 0, minLongitude: 0, maxLatitude: 1, maxLongitude: 1 } },
    { imagery, llm },
    { maxDepth: 1, maxTiles: 8, retainTopK: 1, minimumScore: 0.5 },
  );
  assert.equal(result.tilesExamined, 8);
  assert.equal(result.refinementLevels, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(result.candidates.length, 7);
  assert.equal(result.candidates[0].depth, 1);
  const topCandidateUrl = new URL(result.candidates[0].url);
  assert.equal(topCandidateUrl.origin, 'https://www.google.com');
  assert.equal(topCandidateUrl.pathname, '/maps/search/');
  assert.equal(topCandidateUrl.searchParams.get('api'), '1');
  assert.equal(topCandidateUrl.searchParams.get('query'), `${result.candidates[0].latitude},${result.candidates[0].longitude}`);
  assert.ok(requests.every((request) => request.files?.[0]?.type === 'image/png'));
  assert.ok(requests.every((request) => request.files?.[0]?.encoding === 'base64'));
  assert.ok(requests.every((request) => request.files?.[0]?.path.startsWith('tiles/')));
  assert.ok(configurationRoots.every((root) => root.includes('google-maps-geography-search-')));
});

test('keeps successful leaves when one imagery tile fails', async () => {
  const imagery: SatelliteImageClient = {
    async fetch(tile) {
      if (tile.id === 'r1c1') throw new Error('imagery unavailable');
      return { tile, mimeType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) };
    },
  };
  const llm: ILlmProvider = { async complete() { return response(0.4); } };
  const result = await searchArea(
    { description: 'a clearing', area: { minLatitude: 0, minLongitude: 0, maxLatitude: 1, maxLongitude: 1 } },
    { imagery, llm },
    { maxDepth: 0, maxTiles: 4 },
  );
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].tileId, 'r1c1');
  assert.equal(result.candidates.length, 3);
});

test('keeps a coarse candidate when a refinement child fails', async () => {
  const imagery: SatelliteImageClient = {
    async fetch(tile) {
      if (tile.id === 'r1c1-ne') throw new Error('child imagery unavailable');
      return { tile, mimeType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) };
    },
  };
  const llm: ILlmProvider = { async complete() { return response(0.9); } };
  const result = await searchArea(
    { description: 'a clearing', area: { minLatitude: 0, minLongitude: 0, maxLatitude: 1, maxLongitude: 1 } },
    { imagery, llm },
    { maxDepth: 1, maxTiles: 8, retainTopK: 1 },
  );
  assert.equal(result.failures.some((failure) => failure.tileId === 'r1c1-ne'), true);
  assert.equal(result.candidates.some((candidate) => candidate.tileId === 'r1c1'), true);
  assert.equal(result.candidates.some((candidate) => candidate.tileId === 'r1c1-ne'), false);
});