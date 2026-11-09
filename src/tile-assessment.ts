import { REQUEST_SCHEMA } from 'llm';
import type { ILlmProvider, LlmResponse } from 'llm';
import { locationInTile } from './bounds.js';
import type { CandidateLocation, SearchRequest, SatelliteImage, Tile, TileAssessment } from './types.js';

const ASSESSMENT_SCHEMA = JSON.stringify({
  $id: 'https://schemas.handschuh.dev/google-maps-geography-search/tile-assessment/v1',
  type: 'object',
  additionalProperties: false,
  required: ['match', 'score', 'reason', 'relativeLocation'],
  properties: {
    match: { type: 'boolean' },
    score: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    relativeLocation: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y'],
      properties: {
        x: { type: 'number', minimum: 0, maximum: 1 },
        y: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
  },
});

function assessmentValue(response: LlmResponse): TileAssessment {
  if (response.status !== 'success' || !response.output || response.output.$type !== 'object') {
    throw new Error(response.errors[0]?.message ?? `LLM response status was ${response.status}.`);
  }
  const value = response.output.value as Partial<TileAssessment>;
  if (typeof value.match !== 'boolean' || typeof value.score !== 'number' || typeof value.reason !== 'string' || !value.relativeLocation || typeof value.relativeLocation.x !== 'number' || typeof value.relativeLocation.y !== 'number') {
    throw new Error('LLM returned an incomplete tile assessment.');
  }
  return {
    match: value.match,
    score: Math.max(0, Math.min(1, value.score)),
    reason: value.reason,
    relativeLocation: {
      x: Math.max(0, Math.min(1, value.relativeLocation.x)),
      y: Math.max(0, Math.min(1, value.relativeLocation.y)),
    },
  };
}

export function assessmentRequest(request: SearchRequest, tile: Tile, imagePath: string, image: SatelliteImage, model: string) {
  return {
    schema: REQUEST_SCHEMA,
    model,
    thinking: 'low' as const,
    maxFailedAttempts: 2,
    maxIterations: 2,
    task: JSON.stringify({
      description: request.description,
      tile: {
        id: tile.id,
        depth: tile.depth,
        bounds: tile.bounds,
        center: tile.center,
        zoom: tile.zoom,
      },
    }),
    systemPrompt: [
      'You are a careful satellite-image search assistant.',
      'Compare the user description with the attached satellite image.',
      'Score the probability that the described feature is visible in this tile.',
      'Do not invent details or treat the score as proof.',
      'relativeLocation uses x from west (0) to east (1) and y from north (0) to south (1).',
      'Return only JSON that satisfies the output schema.',
    ].join(' '),
    files: [{
      name: `satellite-${tile.id}`,
      path: imagePath,
      type: image.mimeType,
      encoding: 'base64' as const,
      purpose: 'Satellite imagery for adaptive location search.',
    }],
    outputSchema: ASSESSMENT_SCHEMA,
  };
}

export function candidateFromAssessment(tile: Tile, assessment: TileAssessment): CandidateLocation {
  const location = locationInTile(tile, assessment.relativeLocation);
  return {
    tileId: tile.id,
    ...(tile.parentId ? { parentId: tile.parentId } : {}),
    depth: tile.depth,
    latitude: location.latitude,
    longitude: location.longitude,
    score: assessment.score,
    match: assessment.match,
    reason: assessment.reason,
    tileBounds: tile.bounds,
    zoom: tile.zoom,
  };
}

export async function assessTile(llm: ILlmProvider, request: SearchRequest, tile: Tile, imagePath: string, image: SatelliteImage, model: string, configurationRoot: string): Promise<{ assessment: TileAssessment; candidate: CandidateLocation; response: LlmResponse }> {
  const response = await llm.complete(assessmentRequest(request, tile, imagePath, image, model), { configurationRoot });
  const assessment = assessmentValue(response);
  return { assessment, candidate: candidateFromAssessment(tile, assessment), response };
}

export { ASSESSMENT_SCHEMA };