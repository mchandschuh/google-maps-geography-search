import type { SatelliteImage, SatelliteImageClient, Tile } from './types.js';

export interface GoogleStaticMapsOptions {
  readonly apiKey: string;
  readonly size?: string;
  readonly scale?: number;
  readonly fetchImpl?: typeof fetch;
}

export function createSatelliteImageUrl(tile: Tile, options: GoogleStaticMapsOptions): string {
  const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
  url.searchParams.set('center', `${tile.center.latitude},${tile.center.longitude}`);
  url.searchParams.set('zoom', String(tile.zoom));
  url.searchParams.set('size', options.size ?? '640x640');
  url.searchParams.set('scale', String(options.scale ?? 2));
  url.searchParams.set('maptype', 'satellite');
  url.searchParams.set('key', options.apiKey);
  return url.toString();
}

export class GoogleStaticMapsSatelliteClient implements SatelliteImageClient {
  private readonly fetchImpl: typeof fetch;

  public constructor(private readonly options: GoogleStaticMapsOptions) {
    if (!options.apiKey) throw new Error('GOOGLE_MAPS_API_KEY is required.');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async fetch(tile: Tile): Promise<SatelliteImage> {
    const response = await this.fetchImpl(createSatelliteImageUrl(tile, this.options));
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase() ?? '';
    if (!response.ok || contentType !== 'image/png') {
      const message = new TextDecoder().decode(bytes).slice(0, 300).replace(/\s+/gu, ' ').trim();
      throw new Error(`Google Static Maps returned HTTP ${response.status}${message ? `: ${message}` : '.'}`);
    }
    return { tile, mimeType: 'image/png', bytes };
  }
}