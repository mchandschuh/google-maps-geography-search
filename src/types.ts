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

export interface AdaptiveSearchOptions {
  readonly initialRows?: number;
  readonly initialColumns?: number;
  readonly maxDepth?: number;
  readonly maxTiles?: number;
  readonly retainTopK?: number;
  readonly minimumScore?: number;
  readonly model?: string;
}

export interface TileAssessment {
  readonly match: boolean;
  readonly score: number;
  readonly reason: string;
  readonly relativeLocation: {
    readonly x: number;
    readonly y: number;
  };
}

export interface CandidateLocation {
  readonly tileId: string;
  readonly parentId?: string;
  readonly depth: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly url: string;
  readonly score: number;
  readonly match: boolean;
  readonly reason: string;
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