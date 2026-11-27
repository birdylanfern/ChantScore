# ChantScore

A browser-based Gregorian chant notation studio: place neumes visually or edit GABC source live, point Psalm, Reading, and Preface texts in Latin or English, audition on three synthesized organs, and export GABC, PNG, PDF, MP3, or backups. Everything runs client-side with bundled fonts.

## Run locally

Requires Node.js 22.

```sh
npm install
npm run dev      # http://localhost:3000
npm test         # unit tests (GABC, syllabification, tones, storage, library)
npm run lint     # TypeScript check
npm run build
```

## Working with scores and backups

- **My scores** (`Home` or `Export` → **My scores**): scores autosave into a multi-score library in this browser. You can create, open, duplicate, rename, or delete scores without overwriting existing work. Dropping a `.gabc` or `.chantscore.json` file onto the workspace opens it as a new score.
- **Full backups:** browser storage can still be cleared by browser or system cleanup. Use **Back up everything** (`My scores` or `Export`) to download a `.chantscore-library.json` archive containing every score, your tone settings, workspace preferences, and custom **preface templates** (which live in browser storage only). Restore with **Restore backup…** and choose how to resolve any conflicts.
- **Single-score exports & links:** **Save Project** (`.chantscore.json`) preserves fonts, page setup, and colours for one score; **Export GABC** saves plain `.gabc`; **Copy share link** encodes notation and text in the URL (`#gabc=…`, excluding fonts and colours) and opens as a new score in **My scores**.
- **Live GABC panel:** edits in the source panel validate and apply automatically (~300 ms) with Undo coalescing and line-level warnings. Untouched GABC tokens are preserved byte-for-byte even when they contain features the visual canvas does not draw. Use **Text** in the GABC panel to syllabify Latin or English text onto existing notes.
- **Tones tab:** dockable beside or below the score with **Psalm**, **Reading**, and **Preface** modes in Latin or English, customizable built-in tone definitions, clickable stress/termination review, and on-score phrase cadence pills and break handles.

## Keyboard shortcuts

- **Tools & view:** `V` Select · `N` Insert · `1`–`6` single neumes · `7`–`0` multi-note neumes · `Z` Drag zoom · `F` Fit Width / Fit Page · `` ` `` Fullscreen · `Esc` exit fullscreen/zoom or switch to Select
- **Selection & editing:** `ArrowLeft` / `ArrowRight` move & audition · `ArrowUp` / `ArrowDown` shift pitch · `M` mora · `E` horizontal episema · `I` vertical episema · `B` flat · `H` natural · `L` liquescent · `Delete` / `Backspace` delete
- **Playback & global:** tap `Space` Play/Pause · hold `Space` Pan · `Ctrl/Cmd+S` save now · `Ctrl/Cmd+E` open Export tab · `Ctrl/Cmd+Z` / `Ctrl/Cmd+Y` Undo/Redo · `Ctrl/Cmd+C` / `Ctrl/Cmd+V` Copy/Paste

## Browser storage keys

- **IndexedDB (`chantscore.library.v1`):** multi-score library (`scores` object store), with non-destructive one-time import from `chantscore.project.v2` / `v1`.
- **`localStorage`:** `chantscore.activeScoreId.v1`, `chantscore.backupState.v1`, `chantscore.tones.v1`, `chantscore.workspace.prefs.v1`, `chantscore.prefaceTemplates.v1`, `chantscore.library.fallback.v1` (when IndexedDB is unavailable), plus legacy `chantscore.project.v2` / `chantscore.project.v1`.

Third-party licences: see `THIRD_PARTY_NOTICES.md`. Release notes: `CHANGELOG.md`.

## Deploy to GitHub Pages

ChantScore is a static Vite/React application; all notation, audio, font embedding, and exports run in the browser without a server or API key.

1. Push the repository contents (including `.github/workflows/deploy.yml`) to `main`.
2. In GitHub, open **Settings → Pages → Build and deployment** and select **GitHub Actions**.
3. Run or wait for **Deploy Chantscore to GitHub Pages** under **Actions**.
4. Your site will be served at `https://USERNAME.github.io/REPOSITORY/` (or `https://USERNAME.github.io/` for a user site).

The workflow detects `GITHUB_REPOSITORY` to set Vite's asset `base` path and runs `npm test`, `npm run lint`, and `npm run build` before publishing. Browser storage is per-origin: scores saved locally on `localhost` do not transfer automatically to GitHub Pages, so use **Back up everything** and **Restore backup…** to move your library.
