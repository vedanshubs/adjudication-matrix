# Adjudication — POC

Criminal charge → offense mapping (v5 taxonomy) → adjudication decision matrix.
Deterministic cascade (Layer 0 → Tiers 1–3) + a real in-browser AI tier (embedder + reranker),
plus per-person dedup and a threshold-based decision matrix.

## Requirements
- **Node.js 20 or newer** (includes npm). Check with `node --version`.
- **Internet** is needed twice:
  1. `npm install` (downloads packages).
  2. The **first** time you click "Run AI classification" — the browser downloads the small
     models (~60 MB) from HuggingFace and caches them. The deterministic tiers, the Candidate
     page, and everything else work fully offline; only the AI tier's first run needs the network.

## Moving it to another machine
Zip the folder **without** these (bulky / machine-specific — they get recreated):
- `node_modules/`  ← must be excluded (native binaries differ per OS)
- `dist/`

Keep everything else — including `src/core/generated/` (the compiled data + anchor embeddings)
and `Data/` (the source spreadsheets).

Quick way to make a clean zip (PowerShell, from the parent folder):
```powershell
# from inside C:\Adjudication
Remove-Item -Recurse -Force node_modules, dist -ErrorAction SilentlyContinue
Compress-Archive -Path * -DestinationPath ..\Adjudication.zip
```

## Running it on the new machine
```bash
npm install          # restore dependencies for this OS
npm run dev          # starts Vite at http://localhost:5173
```
Then open **http://localhost:5173** in a browser. (`npm run dev` auto-runs `build:data` first.)

## If the data files are missing
`src/core/generated/` is normally included in the zip. If it's absent (e.g. you cloned from
git, which ignores it), regenerate it:
```bash
npm run build:data         # taxonomy + KB + keyword anchors (fast, offline)
npm run build:embeddings   # anchor embeddings for the AI tier (~20s, needs internet once)
```

## Commands
| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload (localhost:5173) |
| `npm test` | Run the unit tests (Vitest) |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve the production build |
| `npm run build:data` | Compile spreadsheets → typed JSON |
| `npm run build:embeddings` | Precompute anchor embeddings for the AI tier |

## Layout
```
src/core/      mapping, matrix, ai, data (framework-agnostic, tested)
src/core/generated/   compiled data (taxonomy, kb, anchors, embeddings)
src/web/       the UI (Cascade trace + Candidate views)
scripts/       build-data, build-embeddings
test/          unit tests
Data/          source spreadsheets (v5 map, state KBs, prod data)
```
