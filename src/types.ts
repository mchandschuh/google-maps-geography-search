import type { ILlmProvider, LlmResponse } from 'llm';

export interface BoundingBox {
  readonly minLatitude: number;
  readonly minLongitude: number;
  readonly maxLatitude: number;
  readonly maxLongitude: number;
}

export interface Tile {
  readonly id: string;
  readonly depth: number;
  readonly parentId?: string;
  readonly bounds: BoundingBox;
  readonly center: {
    readonly latitude: number;
    readonly longitude: number;
  };
  readonly zoom: number;
}

export interface SatelliteImage {
  readonly tile: Tile;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface SatelliteImageClient {
  fetch(tile: Tile): Promise<SatelliteImage>;
}

export interface SearchRequest {
  readonly description: string;
  readonly area: BoundingBox;
}

export type SearchStage = 'coarse' | 'intermediate' | 'fine';

export type TileDecision = 'discard' | 'refine' | 'report';

export type TileEvidence =
  | 'water_feature'
  | 'stream_corridor'
  | 'shoreline'
  | 'road_or_clearing'
  | 'parking_geometry'
  | 'tree_line_deformation'
  | 'open_sky'
  | 'terrain_access'
  | 'negative_water_evidence'
  | 'negative_access_evidence'
  | 'negative_sky_evidence'
  | 'uncertain';

export interface AdaptiveSearchOptions {
  readonly initialRows?: number;
  readonly initialColumns?: number;
  readonly maxDepth?: number;
  readonly maxTiles?: number;
  readonly refinementBeamWidth?: number;
  readonly minimumScore?: number;
  readonly model?: string;
}

export interface TileAssessment {
  readonly decision: TileDecision;
  readonly match: boolean;
  readonly score: number;
  readonly reason: string;
  readonly evidence: readonly TileEvidence[];
  readonly relativeLocation: {
    readonly x: number;
    readonly y: number;
  };
}

export interface CandidateLocation {
  readonly tileId: string;
  readonly parentId?: string;
  readonly depth: number;
  readonly stage: SearchStage;
  readonly decision: Exclude<TileDecision, 'discard'>;
  readonly latitude: number;
  readonly longitude: number;
  readonly url: string;
  readonly score: number;
  readonly match: boolean;
  readonly reason: string;
  readonly evidence: readonly TileEvidence[];
  readonly tileBounds: BoundingBox;
  readonly zoom: number;
}

export interface TileFailure {
  readonly tileId: string;
  readonly depth: number;
  readonly message: string;
}

export interface SearchResult {
  readonly description: string;
  readonly area: BoundingBox;
  readonly candidates: readonly CandidateLocation[];
  readonly reportedSpots: readonly CandidateLocation[];
  readonly failures: readonly TileFailure[];
  readonly tilesExamined: number;
  readonly refinementLevels: number;
}

export interface SearchDependencies {
  readonly imagery: SatelliteImageClient;
  readonly llm: ILlmProvider;
}

export interface TileEvaluation {
  readonly tile: Tile;
  readonly assessment: TileAssessment;
  readonly response: LlmResponse;
}