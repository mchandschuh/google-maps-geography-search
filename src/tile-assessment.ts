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
  if (!['discard', 'refine', 'report'].includes(value.decision as string) || typeof value.match !== 'boolean' || typeof value.score !== 'number' || typeof value.reason !== 'string' || !Array.isArray(value.evidence) || value.evidence.length === 0 || !value.relativeLocation || typeof value.relativeLocation.x !== 'number' || typeof value.relativeLocation.y !== 'number') {
    throw new Error('LLM returned an incomplete tile assessment.');
  }
  return {
    decision: value.decision as TileDecision,
    match: value.match,
    score: Math.max(0, Math.min(1, value.score)),
    reason: value.reason,
    evidence: value.evidence as TileEvidence[],
    relativeLocation: {
      x: Math.max(0, Math.min(1, value.relativeLocation.x)),
      y: Math.max(0, Math.min(1, value.relativeLocation.y)),
    },
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
      `This tile is being assessed at the ${stage} stage.`,
      'At the coarse stage, look for credible regions and visual signals worth refining; do not require the exact spot to be visible.',
      'At the intermediate stage, narrow promising regions by checking relationships among the requested feature, water, roads, clearings, shorelines, terrain, and sky openings.',
      'At the fine stage, report only when the specific requested spot is visibly identifiable; otherwise choose refine if more resolution would help.',
      'For water searches at low resolution, treat obvious water, winding stream corridors, tree-line deformations suggesting streams, shorelines, roads approaching water, and clearings near water as reasons to refine.',
      'Do not confuse generic forest, shadows, distant water, a road, or a broad water body with an exact spot.',
      'Use discard when there is no credible matching region, refine when a likely region needs smaller child tiles, and report when an actual spot is visible.',
      'Separate visible evidence from inference. Do not claim legal access, permission, current road condition, or ownership from imagery alone.',
      'Keep every promising region: a refine decision is useful even when no exact spot can yet be reported.',
      'relativeLocation uses x from west (0) to east (1) and y from north (0) to south (1). For refine, identify the promising subregion; for report, identify the actual spot.',
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