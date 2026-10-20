# ReelzTV

A free, no-signup streaming dashboard for **movies, TV series and anime** — plus a
separate age-gated Adult section. It is a 100% static React app: no backend, no
accounts, no database. Everything it remembers (watch history, My List, gate
acceptances) lives in the visitor's own browser.

## Features

- **Home** rails, plus **Movies / TV / Anime** browse tabs with server-side
  genre, year and rating filtering.
- **Playback servers** presented as *Coco I / Coco II / Coco III* — movies
  default to Coco I, TV and anime to Coco II, and the choice is remembered.
- **Watch history & My List**, stored locally; an "availability memory" knows
  which titles previously failed to play and labels them *Not Available*.
- **Telegram community gate** before streaming — a soft, no-backend check that
  re-prompts every 24 hours.
- **Adult section (18+)**: age gate on entry, fully isolated from global search,
  My List and watch history. Its own search bar queries the live catalog
  directly, the grid pages with a *Load more* button, and the player opens in a
  responsive 16:9 iframe. A bundled placeholder list guarantees the section is
  never an empty screen.
- **Donation modal** (BNB + SOL) reachable from the header.
- **Installable PWA** with a service worker (HTML is network-first, hashed
  assets are cached) so repeat visits load fast and the app still opens offline.
- Fully responsive, keyboard-friendly, and green under `oxlint`.

## Getting started

```bash
npm install
npm run dev       # http://localhost:5173
```

| Command           | What it does                              |
| ----------------- | ----------------------------------------- |
| `npm run dev`     | Dev server with hot reload                |
| `npm run build`   | Production build into `dist/`             |
| `npm run preview` | Serves the built `dist/` locally          |
| `npm run lint`    | Runs oxlint                               |

## Deploying

The build output is plain static files — point any static host at `dist/`:

1. `npm run build`
2. Publish the contents of `dist/` (Netlify, Vercel, Cloudflare Pages,
   GitHub Pages, S3, or a plain web server).

Deploying at a **domain root** needs no extra configuration. If you host it
under a sub-path instead (for example a GitHub Pages project site), set the
matching `base` option in `vite.config.js`.

### Editing content

- `public/adult.json` — host-editable fallback list for the Adult section,
  served as-is (empty by default; no rebuild needed to change it).
- `public/manifest.webmanifest` — PWA name, icons and colours.
- `src/adult.js` — live catalog settings (`ADULT_LIVE`), the bundled placeholder
  list (`ADULT_VIDEOS`), and the age-gate memory duration.
- `src/codes.js` — encoded playback host metadata.

## Privacy

No analytics, no trackers, no cookies. The site never sends credentials and
stores nothing server-side.
