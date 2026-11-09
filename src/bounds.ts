import type { AdaptiveSearchOptions, BoundingBox, Tile } from './types.js';

const MAX_MERCATOR_LATITUDE = 85.05112878;

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
}

export function validateBoundingBox(area: BoundingBox): void {
  finite('minLatitude', area.minLatitude);
  finite('minLongitude', area.minLongitude);
  finite('maxLatitude', area.maxLatitude);
  finite('maxLongitude', area.maxLongitude);
  if (area.minLatitude < -90 || area.maxLatitude > 90) throw new Error('Latitude must be between -90 and 90.');
  if (area.minLongitude < -180 || area.maxLongitude > 180) throw new Error('Longitude must be between -180 and 180.');
  if (area.minLatitude >= area.maxLatitude) throw new Error('minLatitude must be less than maxLatitude.');
  if (area.minLongitude >= area.maxLongitude) throw new Error('minLongitude must be less than maxLongitude.');
}

function integerBetween(name: string, value: number, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
}

export function validateSearchOptions(options: Required<AdaptiveSearchOptions>): void {
  integerBetween('initialRows', options.initialRows, 1, 8);
  integerBetween('initialColumns', options.initialColumns, 1, 8);
  integerBetween('maxDepth', options.maxDepth, 0, 6);
  integerBetween('maxTiles', options.maxTiles, 1, 128);
  integerBetween('retainTopK', options.retainTopK, 1, 16);
  if (options.maxTiles < options.initialRows * options.initialColumns) {
    throw new Error('maxTiles must be at least the initial tile count.');
  }
  if (options.minimumScore < 0 || options.minimumScore > 1 || !Number.isFinite(options.minimumScore)) {
    throw new Error('minimumScore must be between 0 and 1.');
  }
}

function center(bounds: BoundingBox): { latitude: number; longitude: number } {
  return {
    latitude: (bounds.minLatitude + bounds.maxLatitude) / 2,
    longitude: (bounds.minLongitude + bounds.maxLongitude) / 2,
  };
}

function mercatorY(latitude: number): number {
  const clamped = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
  const radians = (clamped * Math.PI) / 180;
  return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
}

export interface ZoomFitOptions {
  readonly width?: number;
  readonly height?: number;
  readonly padding?: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
}

export function fitZoom(area: BoundingBox, options: ZoomFitOptions = {}): number {
  validateBoundingBox(area);
  const width = options.width ?? 640;
  const height = options.height ?? 640;
  const padding = options.padding ?? 0.1;
  const minZoom = options.minZoom ?? 0;
  const maxZoom = options.maxZoom ?? 21;
  if (width <= 0 || height <= 0) throw new Error('Zoom-fit dimensions must be positive.');
  if (padding < 0 || padding >= 0.5) throw new Error('Zoom-fit padding must be between 0 and 0.5.');
  const availableWidth = width * (1 - padding * 2);
  const availableHeight = height * (1 - padding * 2);
  const longitudeSpan = area.maxLongitude - area.minLongitude;
  const mercatorSpan = Math.abs(mercatorY(area.minLatitude) - mercatorY(area.maxLatitude));
  const longitudeZoom = Math.log2((availableWidth * 360) / (256 * longitudeSpan));
  const latitudeZoom = mercatorSpan === 0 ? maxZoom : Math.log2(availableHeight / (256 * mercatorSpan));
  return Math.max(minZoom, Math.min(maxZoom, Math.floor(Math.min(longitudeZoom, latitudeZoom))));
}

export function createTile(id: string, bounds: BoundingBox, depth: number, parentId?: string, options?: ZoomFitOptions): Tile {
  return {
    id,
    depth,
    ...(parentId ? { parentId } : {}),
    bounds,
    center: center(bounds),
    zoom: fitZoom(bounds, options),
  };
}

export function createInitialTiles(area: BoundingBox, rows = 2, columns = 2, options?: ZoomFitOptions): Tile[] {
  validateBoundingBox(area);
  integerBetween('rows', rows, 1, 64);
  integerBetween('columns', columns, 1, 64);
  const latitudeStep = (area.maxLatitude - area.minLatitude) / rows;
  const longitudeStep = (area.maxLongitude - area.minLongitude) / columns;
  const tiles: Tile[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const bounds: BoundingBox = {
        minLatitude: area.maxLatitude - (row + 1) * latitudeStep,
        minLongitude: area.minLongitude + column * longitudeStep,
        maxLatitude: area.maxLatitude - row * latitudeStep,
        maxLongitude: area.minLongitude + (column + 1) * longitudeStep,
      };
      tiles.push(createTile(`r${row + 1}c${column + 1}`, bounds, 0, undefined, options));
    }
  }
  return tiles;
}

export function subdivideTile(tile: Tile, options?: ZoomFitOptions): Tile[] {
  const midLatitude = (tile.bounds.minLatitude + tile.bounds.maxLatitude) / 2;
  const midLongitude = (tile.bounds.minLongitude + tile.bounds.maxLongitude) / 2;
  const childDepth = tile.depth + 1;
  return [
    createTile(`${tile.id}-nw`, { minLatitude: midLatitude, minLongitude: tile.bounds.minLongitude, maxLatitude: tile.bounds.maxLatitude, maxLongitude: midLongitude }, childDepth, tile.id, options),
    createTile(`${tile.id}-ne`, { minLatitude: midLatitude, minLongitude: midLongitude, maxLatitude: tile.bounds.maxLatitude, maxLongitude: tile.bounds.maxLongitude }, childDepth, tile.id, options),
    createTile(`${tile.id}-sw`, { minLatitude: tile.bounds.minLatitude, minLongitude: tile.bounds.minLongitude, maxLatitude: midLatitude, maxLongitude: midLongitude }, childDepth, tile.id, options),
    createTile(`${tile.id}-se`, { minLatitude: tile.bounds.minLatitude, minLongitude: midLongitude, maxLatitude: midLatitude, maxLongitude: tile.bounds.maxLongitude }, childDepth, tile.id, options),
  ];
}

export function locationInTile(tile: Tile, relativeLocation: { readonly x: number; readonly y: number }): { latitude: number; longitude: number } {
  const x = Math.max(0, Math.min(1, relativeLocation.x));
  const y = Math.max(0, Math.min(1, relativeLocation.y));
  return {
    longitude: tile.bounds.minLongitude + x * (tile.bounds.maxLongitude - tile.bounds.minLongitude),
    latitude: tile.bounds.maxLatitude - y * (tile.bounds.maxLatitude - tile.bounds.minLatitude),
  };
}