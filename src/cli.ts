#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { complete } from 'llm';
import { fileURLToPath } from 'node:url';
import { searchArea } from './adaptive-search.js';
import { GoogleStaticMapsSatelliteClient } from './google-static-maps.js';
import type { BoundingBox } from './types.js';
import type { ILlmProvider } from 'llm';

const llmProvider: ILlmProvider = { complete };

function usage(): string {
  return `Usage:
  satellite-search --description TEXT --bbox MIN_LAT,MIN_LNG,MAX_LAT,MAX_LNG [options]

Required environment variables:
  GOOGLE_MAPS_API_KEY   Google Maps Static API key
  OPENROUTER_API_KEY    Key used by the llm provider

Options:
  --max-depth N         Refinement levels after the coarse pass (default: 6)
  --max-tiles N         Maximum satellite tiles assessed (default: 48)
  --refinement-beam N   Strongest regions refined per level (default: 1)
  --model ID            Vision model (default: openai/gpt-5.6-luna)
  --help                Show this help

Zoom is selected automatically for every tile. The search starts coarse and
only increases resolution in areas that appear promising.

Example:
  satellite-search \\
    --description "a circular dirt clearing beside a tree line" \\
    --bbox 37.70,-122.52,37.78,-122.42`;
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function requiredOption(args: readonly string[], name: string): string {
  const value = optionValue(args, name);
  if (!value || value.startsWith('--')) throw new Error(`${name} is required.`);
  return value;
}

function integerOption(args: readonly string[], name: string, fallback: number): number {
  const value = optionValue(args, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer.`);
  return parsed;
}

function parseBoundingBox(value: string): BoundingBox {
  const values = value.split(',').map(Number);
  if (values.length !== 4 || values.some((part) => !Number.isFinite(part))) throw new Error('--bbox must be MIN_LAT,MIN_LNG,MAX_LAT,MAX_LNG.');
  return { minLatitude: values[0], minLongitude: values[1], maxLatitude: values[2], maxLongitude: values[3] };
}

export async function runCli(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (args.length === 0 || args.includes('--help')) {
    console.log(usage());
    return;
  }
  const description = requiredOption(args, '--description');
  const area = parseBoundingBox(requiredOption(args, '--bbox'));
  const maxDepth = integerOption(args, '--max-depth', 6);
  const maxTiles = integerOption(args, '--max-tiles', 48);
  const refinementBeamWidth = integerOption(args, '--refinement-beam', 1);
  const model = optionValue(args, '--model') ?? 'openai/gpt-5.6-luna';
  const imagery = new GoogleStaticMapsSatelliteClient({ apiKey: process.env.GOOGLE_MAPS_API_KEY ?? '' });
  const result = await searchArea({ description, area }, { imagery, llm: llmProvider }, { maxDepth, maxTiles, refinementBeamWidth, model });
  console.log(JSON.stringify(result, null, 2));
}

const entryPath = process.argv[1];
const isEntryPoint = entryPath !== undefined && realpathSync(entryPath) === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}