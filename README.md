# Google Maps Geography Search

An intentionally small adaptive satellite-image searcher. Give it a natural-language description and a bounding box; it starts with a coarse satellite grid, asks a vision model which tiles look promising, and automatically refines only those areas.

```text
description + bounding box
  → coarse satellite tiles
  → structured vision assessment
  → retain likely areas
  → subdivide and increase resolution
  → ranked approximate coordinates
```

This is a screening tool, not survey-grade geolocation. Satellite image date, resolution, cloud cover, occlusion, model errors, and false positives all matter.

## Requirements

- Node.js 22+
- A Google Cloud project with billing enabled and Maps Static API enabled
- `GOOGLE_MAPS_API_KEY`
- `OPENROUTER_API_KEY`
- The sibling local [`llm`](https://github.com/mchandschuh/llm) checkout at `../llm`

The searcher imports `complete` and `ILlmProvider` from the public `llm` package. Downloaded PNGs are written to a temporary workspace and supplied through `request.files` with `type: "image/png"`; the `llm` package reads them as binary, encodes them as base64, and sends them to OpenRouter as `image_url` parts. The task and output contracts are versioned under `schemas/tile-assessment/v1/`; both schemas include descriptions/examples and are passed to `llm.complete()` for prompt context and validation.

## Setup

Build the sibling LLM package first:

```bash
cd /home/michael/src/github/llm
npm ci
npm run build
```

Then install and validate this repository:

```bash
cd /home/michael/src/github/google-maps-geography-search
npm install
npm run typecheck
npm test
npm run build
```

## Run

Load the OpenRouter credentials and provide a Google Maps key:

```bash
source /home/michael/src/shell/environment/openrouter
export GOOGLE_MAPS_API_KEY='...'
```

Run a search:

```bash
node dist/cli.js \
  --description "a circular dirt clearing beside a tree line" \
  --bbox 37.70,-122.52,37.78,-122.42
```

The user does not provide a zoom level. Each tile gets an automatically calculated zoom that fits its bounds into a 640×640 Static Maps image. The default search starts with a 2×2 grid, retains every promising region, and follows the strongest region through up to six refinement levels while examining at most 48 tiles. Coarse candidates remain in the output while deeper candidates are added. Use `--refinement-beam N` to follow more strong regions per level when you prefer breadth over maximum depth.

Optional bounded-search controls:

```text
--max-depth N   Refinement levels after the coarse pass (default: 2)
--max-tiles N   Maximum satellite tiles assessed (default: 28)
--model ID      Vision model (default: openai/gpt-5.6-luna)
```

The output is JSON containing all retained candidate regions, a separate `reportedSpots` list for fine-stage exact spots, approximate latitude/longitude, a `url` linking directly to each coordinate in Google Maps, decision/evidence fields, score, explanation, tile bounds, zoom, failures, and search counts. Candidate links use the platform's cross-device Maps URLs format and do not require another API key to open. A `refine` candidate means the region is promising but needs more resolution; a `report` candidate means the model believes a specific spot is visible.

## Google Static Maps behavior

The client requests `maptype=satellite`, `size=640x640`, and `scale=2`. Google documents 640×640 as the normal maximum request size, or 1280×1280 with scale 2; larger images require separate approval. The client calculates `center` and `zoom` from each tile rather than asking the API to infer a viewport.

## Non-goals

- No web UI
- No adaptive search across the antimeridian
- No reverse geocoding
- No image caching
- No unrestricted parallel request scheduler
- No claim of exact or survey-grade coordinates