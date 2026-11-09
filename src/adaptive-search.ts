import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInitialTiles, subdivideTile, validateBoundingBox, validateSearchOptions } from './bounds.js';
import { assessTile } from './tile-assessment.js';
import type { AdaptiveSearchOptions, CandidateLocation, SearchDependencies, SearchRequest, SearchResult, Tile, TileFailure, TileEvaluation } from './types.js';

const DEFAULTS: Required<AdaptiveSearchOptions> = {
  initialRows: 2,
  initialColumns: 2,
  maxDepth: 2,
  maxTiles: 28,
  retainTopK: 3,
  minimumScore: 0.55,
  model: 'openai/gpt-5.6-luna',
};

function optionsWithDefaults(options: AdaptiveSearchOptions): Required<AdaptiveSearchOptions> {
  return { ...DEFAULTS, ...options };
}

function fileName(tile: Tile, mimeType: string): string {
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
  return `tiles/${tile.id}.${extension}`;
}

function selectTilesToRefine(evaluations: readonly TileEvaluation[], options: Required<AdaptiveSearchOptions>, remainingTileBudget: number): readonly Tile[] {
  const maximumSelected = Math.min(options.retainTopK, Math.floor(remainingTileBudget / 4));
  if (maximumSelected < 1) return [];
  return evaluations
    .filter((evaluation) => evaluation.assessment.score >= options.minimumScore)
    .sort((left, right) => right.assessment.score - left.assessment.score)
    .slice(0, maximumSelected)
    .map((evaluation) => evaluation.tile);
}

export async function searchArea(request: SearchRequest, dependencies: SearchDependencies, suppliedOptions: AdaptiveSearchOptions = {}): Promise<SearchResult> {
  if (!request.description.trim()) throw new Error('description must not be empty.');
  validateBoundingBox(request.area);
  const options = optionsWithDefaults(suppliedOptions);
  validateSearchOptions(options);
  const workspace = await mkdtemp(join(tmpdir(), 'google-maps-geography-search-'));
  await mkdir(join(workspace, 'tiles'));
  let frontier = createInitialTiles(request.area, options.initialRows, options.initialColumns);
  const leaves = new Map<string, CandidateLocation>();
  const failures: TileFailure[] = [];
  let tilesExamined = 0;
  let refinementLevels = 0;
  let pendingRefinements: ReadonlyMap<string, readonly string[]> = new Map();
  try {
    while (frontier.length > 0 && refinementLevels <= options.maxDepth && tilesExamined < options.maxTiles) {
      const available = options.maxTiles - tilesExamined;
      const levelTiles = frontier.slice(0, available);
      const evaluations: TileEvaluation[] = [];
      for (const tile of levelTiles) {
        tilesExamined += 1;
        try {
          const image = await dependencies.imagery.fetch(tile);
          const relativePath = fileName(tile, image.mimeType);
          await writeFile(join(workspace, relativePath), image.bytes);
          const evaluation = await assessTile(dependencies.llm, request, tile, relativePath, image, options.model, workspace);
          evaluations.push({ tile, ...evaluation });
          leaves.set(tile.id, evaluation.candidate);
        } catch (error) {
          failures.push({ tileId: tile.id, depth: tile.depth, message: error instanceof Error ? error.message : 'Tile evaluation failed.' });
        }
      }
      const successfulIds = new Set(evaluations.map((evaluation) => evaluation.tile.id));
      const failedIds = new Set(failures.filter((failure) => levelTiles.some((tile) => tile.id === failure.tileId)).map((failure) => failure.tileId));
      for (const [parentId, childIds] of pendingRefinements) {
        const complete = childIds.every((childId) => successfulIds.has(childId)) && childIds.every((childId) => !failedIds.has(childId));
        if (complete) {
          leaves.delete(parentId);
        } else {
          for (const childId of childIds) leaves.delete(childId);
        }
      }
      if (refinementLevels >= options.maxDepth) break;
      const selected = selectTilesToRefine(evaluations, options, options.maxTiles - tilesExamined);
      if (selected.length === 0) break;
      frontier = selected.flatMap((tile) => subdivideTile(tile));
      refinementLevels += 1;
      pendingRefinements = new Map(selected.map((tile) => [tile.id, frontier.filter((child) => child.parentId === tile.id).map((child) => child.id)]));
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
  return {
    description: request.description,
    area: request.area,
    candidates: [...leaves.values()].sort((left, right) => right.score - left.score || right.depth - left.depth),
    failures,
    tilesExamined,
    refinementLevels,
  };
}