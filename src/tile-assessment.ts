import { readFile } from 'node:fs/promises';
import { REQUEST_SCHEMA } from 'llm';
import type { ILlmProvider, LlmResponse } from 'llm';
import { locationInTile } from './bounds.js';
import type { CandidateLocation, SearchRequest, SatelliteImage, SearchStage, Tile, TileAssessment, TileDecision, TileEvidence } from './types.js';

const TASK_SCHEMA = await readFile(new URL('../schemas/tile-assessment/v1/task.schema.json', import.meta.url), 'utf8');
const OUTPUT_SCHEMA = await readFile(new URL('../schemas/tile-assessment/v1/output.schema.json', import.meta.url), 'utf8');

function assessmentValue(response: LlmResponse): TileAssessment {
  if (response.status !== 'success' || !response.output || response.output.$type !== 'object') {
    throw new Error(response.errors[0]?.message ?? `LLM response status was ${response.status}.`);
  }
  const value = response.output.value as Partial<TileAssessment>;
  if (!['discard', 'refine', 'report'].includes(value.decision as string) || typeof value.match !== 'boolean' || typeof value.score !== 'number' || typeof value.reason !== 'string' || !Array.isArray(value.evidence) || value.evidence.length === 0 || !value.relativeLocation || typeof value.relativeLocation.x !== 'number' || typeof value.relativeLocation.y !== 'number' || !value.targetBounds || typeof value.targetBounds.west !== 'number' || typeof value.targetBounds.north !== 'number' || typeof value.targetBounds.east !== 'number' || typeof value.targetBounds.south !== 'number') {
    throw new Error('LLM returned an incomplete tile assessment.');
  }
  const targetBounds = {
    west: Math.max(0, Math.min(1, value.targetBounds.west)),
    north: Math.max(0, Math.min(1, value.targetBounds.north)),
    east: Math.max(0, Math.min(1, value.targetBounds.east)),
    south: Math.max(0, Math.min(1, value.targetBounds.south)),
  };
  if (targetBounds.east < targetBounds.west || targetBounds.south < targetBounds.north) {
    throw new Error('LLM returned inverted target bounds.');
  }
  const x = Math.max(0, Math.min(1, value.relativeLocation.x));
  const y = Math.max(0, Math.min(1, value.relativeLocation.y));
  if (x < targetBounds.west || x > targetBounds.east || y < targetBounds.north || y > targetBounds.south) {
    throw new Error('LLM relativeLocation must be inside targetBounds.');
  }
  return {
    decision: value.decision as TileDecision,
    match: value.match,
    score: Math.max(0, Math.min(1, value.score)),
    reason: value.reason,
    evidence: value.evidence as TileEvidence[],
    relativeLocation: {
      x,
      y,
    },
    targetBounds,
  };
}

function searchStage(tile: Tile): SearchStage {
  if (tile.zoom >= 16) return 'fine';
  if (tile.zoom >= 14) return 'intermediate';
  return 'coarse';
}

export function assessmentRequest(request: SearchRequest, tile: Tile, imagePath: string, image: SatelliteImage, model: string) {
  const stage = searchStage(tile);
  return {
    schema: REQUEST_SCHEMA,
    model,
    thinking: 'low' as const,
    maxFailedAttempts: 2,
    maxIterations: 2,
    task: JSON.stringify({
      description: request.description,
      searchStage: stage,
      tile: {
        id: tile.id,
        depth: tile.depth,
        bounds: tile.bounds,
        center: tile.center,
        zoom: tile.zoom,
      },
    }),
    taskSchema: TASK_SCHEMA,
    systemPrompt: [
      'You are a careful remote-sensing image analyst participating in a hierarchical, coarse-to-fine geographic search.',
      'The user description defines the feature, object, relationship, or location to find. Do not add task-specific requirements that are not in the description.',
      `This tile is being assessed at the ${stage} stage.`,
      'At the coarse stage, search for broad regions and visible patterns related to the description. Exact localization is not required yet. Retain credible regions even when the target is too small to resolve.',
      'At the intermediate stage, narrow promising regions by checking spatial relationships, boundaries, roads, clearings, structures, terrain changes, linear corridors, and other contextual evidence visible in the image.',
      'At the fine stage, report only when the specific requested target is visibly identifiable at the current resolution. Otherwise choose refine if more resolution would help.',
      'Use discard when no credible matching region is visible, refine when a likely region needs smaller child tiles, and report when the requested target itself is visible.',
      'Do not confuse nearby context, a broad region, a visually similar feature, shadows, trees, roads, water, or the tile center with the requested target.',
      'Separate visible evidence from inference. Do not claim legal access, permission, ownership, current road conditions, or other non-visual facts from imagery alone.',
      'relativeLocation uses x from west (0) to east (1) and y from north (0) to south (1). For refine, place it on the most promising subregion. For report, place it at the center of the exact requested target.',
      'targetBounds uses normalized image coordinates: west/north are the top-left target edge and east/south are the bottom-right target edge. For report, targetBounds must enclose the exact visible target, and relativeLocation must lie inside those bounds.',
      'Use the smallest target bounds supported by the image. Do not place relativeLocation on nearby context or use a rough tile center as a substitute for precision.',
      'Return only JSON that satisfies the output schema.',
    ].join(' '),
    files: [{
      name: `satellite-${tile.id}`,
      path: imagePath,
      type: image.mimeType,
      encoding: 'base64' as const,
      purpose: 'Satellite imagery for adaptive location search.',
    }],
    outputSchema: OUTPUT_SCHEMA,
  };
}

export function candidateFromAssessment(tile: Tile, assessment: TileAssessment): CandidateLocation {
  const location = locationInTile(tile, assessment.relativeLocation);
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', `${location.latitude},${location.longitude}`);
  return {
    tileId: tile.id,
    ...(tile.parentId ? { parentId: tile.parentId } : {}),
    depth: tile.depth,
    stage: searchStage(tile),
    decision: assessment.decision === 'discard' ? 'refine' : assessment.decision,
    latitude: location.latitude,
    longitude: location.longitude,
    url: url.toString(),
    score: assessment.score,
    match: assessment.match,
    reason: assessment.reason,
    evidence: assessment.evidence,
    targetBounds: assessment.targetBounds,
    tileBounds: tile.bounds,
    zoom: tile.zoom,
  };
}

export async function assessTile(llm: ILlmProvider, request: SearchRequest, tile: Tile, imagePath: string, image: SatelliteImage, model: string, configurationRoot: string): Promise<{ assessment: TileAssessment; candidate?: CandidateLocation; response: LlmResponse }> {
  const response = await llm.complete(assessmentRequest(request, tile, imagePath, image, model), { configurationRoot });
  const assessment = assessmentValue(response);
  return { assessment, candidate: assessment.decision === 'discard' ? undefined : candidateFromAssessment(tile, assessment), response };
}

export { OUTPUT_SCHEMA, TASK_SCHEMA };