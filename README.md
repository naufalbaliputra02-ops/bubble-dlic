# Drift Drop — Dlicom Playground

A soft-body "watermelon game" built with plain HTML, CSS and canvas: drop Dlicom slimes, merge matching pairs, and send tide waves through the water to line up merges.

**Play:** https://naufalbaliputra02-ops.github.io/bubble-dlic/

## Run locally

```sh
npm run dev   # serves the folder at http://localhost:3000
```

Any static file server works; there is no build step.

## Deploy

The site is plain static files served from the repository root, so GitHub Pages needs no build step. One-time setup: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**. Every push to `main` then republishes the site within about a minute. `.nojekyll` disables Jekyll processing so files are served as-is.

## Controls

- Move the pointer and click (or press Space) to drop the next slime.
- Wave buttons or ← / → send a current through the water (costs tide energy).
- Two slimes of the same kind ooze together into the next size; reach level 10 for the ultimate merge.

Follow [@DlicomApp](https://x.com/DlicomApp).
