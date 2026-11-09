import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInitialTiles, subdivideTile, validateBoundingBox, validateSearchOptions } from './bounds.js';
import { assessTile } from './tile-assessment.js';
import type { AdaptiveSearchOptions, CandidateLocation, SearchDependencies, SearchRequest, SearchResult, Tile, TileFailure, TileEvaluation } from './types.js';

const DEFAULTS: Required<AdaptiveSearchOptions> = {
  initialRows: 2,
  initialColumns: 2,
  maxDepth: 6,
  maxTiles: 48,
  refinementBeamWidth: 1,
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
  const maximumSelected = Math.min(options.refinementBeamWidth, Math.floor(remainingTileBudget / 4));
  if (maximumSelected < 1) return [];
  return evaluations
    .filter((evaluation) => evaluation.assessment.decision === 'refine')
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
  const candidates = new Map<string, CandidateLocation>();
  const failures: TileFailure[] = [];
  let tilesExamined = 0;
  let refinementLevels = 0;
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
          if (evaluation.candidate) candidates.set(tile.id, evaluation.candidate);
        } catch (error) {
          failures.push({ tileId: tile.id, depth: tile.depth, message: error instanceof Error ? error.message : 'Tile evaluation failed.' });
        }
      }
      if (refinementLevels >= options.maxDepth) break;
      const selected = selectTilesToRefine(evaluations, options, options.maxTiles - tilesExamined);
      if (selected.length === 0) break;
      frontier = selected.flatMap((tile) => subdivideTile(tile));
      refinementLevels += 1;
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
  return {
    description: request.description,
    area: request.area,
    candidates: [...candidates.values()].sort((left, right) => right.score - left.score || right.depth - left.depth),
    reportedSpots: [...candidates.values()].filter((candidate) => candidate.decision === 'report').sort((left, right) => right.score - left.score),
    failures,
    tilesExamined,
    refinementLevels,
  };
}