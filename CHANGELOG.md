# Changelog

## Unreleased

## 0.5.0 - 2026-11-27

### Added
- Multi-score library (**My scores**) in IndexedDB with open, new, duplicate, rename, delete, and automatic non-destructive migration from earlier single-score saves.
- Full-library backup (**Back up everything**, `.chantscore-library.json`) and **Restore backup…** with conflict resolution covering scores, tone settings, workspace preferences, and user preface templates.
- Gentle backup reminder chip in the ribbon header when changes are unbacked for 7 days or never backed up, dismissible for 7 days.
- Self-hosted Latin WOFF2 fonts with offline-capable PNG/PDF font embedding and first-paint preloading for UI and default chant typography.
- Keyboard shortcuts for tools, neumes, modifiers, auditioned arrow navigation, Space play/pause or pan, fullscreen, and Undo/Redo/Copy/Paste.
- Persisted **Word spacing** control (`Compact`, `Normal`, `Wide`) in the Home ribbon with wider gaps at word endings and tighter mid-word spacing.

### Changed
- Live GABC source editing validates and commits after ~300 ms with ~800 ms Undo coalescing, green/red status, and cursor/scroll preservation.
- Opening a new score, shared link, `.chantscore.json`, or dropped `.gabc` file creates a new library entry instead of overwriting the active score.
- Moved playback controls and seek bar into the **Playback** ribbon tab with windowed lookahead scheduling so tempo and organ changes apply smoothly mid-playback.
- Improved startup bundle size by lazy-loading the Tones workspace, loading English hyphenation only when English is selected, and loading optional lyric fonts on demand.
- Added `npm run lint` type-checking to the GitHub Pages deployment workflow.

### Tones
- Added a dedicated **Tones** ribbon tab and collapsible side-by-side or below-score dock with **Psalm**, **Reading**, and **Preface** modes.
- Added English syllabification, lexical stress with clickable overrides, English solemn preface pointing, and an English *Gloria Patri*.
- Added on-score phrase cadence pills, bar-line join handles, phrase highlighting, and popover menus for Reading and Preface body phrases.
- Added **Auto-join short phrases** (configurable threshold `0–6`, default `3`) with three-state break tracking and **Reset phrases**.
- Added template-matched **Preface parts** review (`Opening`, `Body`, `Closing`), customizable **Save as template** storage, and per-language line-break phrasing toggles.
- Added a Latin Reading **Opening formula** picker (`None`, `In illo témpore:`, `In diébus illis,`, `Fratres,`, `Caríssime,`), plain-language cadence labels, and **Customize tone** form editor.
- Added *Magníficat* Tone 2 intonation support (`Ma(e)gní(fe)fi(eh hr)cat(h.)`) and replaced the Gospel tone with the ancient ChantTools tone.
- Unified division bars and mora placement so trailing moras and `(,)` / `(;)` / `(:)` / `(::)` bars follow each phrase's effective cadence.

### Removed
- Removed the staged GABC Apply/Discard flow and the standalone Preface dialogue preset list.
- Removed the unused Vite unbundled `src/assets` copy plugin.

### Developer notes
- Storage schema: scores store `ScoreLibraryEntry` records (`chantscore.library.v1`) wrapping `chantscore` schema v2 envelopes; full backups use `chantscore-library` schema v1.
- Added `ensureEnglishHyphenation()`, `ensureFontFamilyLoaded()`, `React.lazy` splits for `TonePanel`/`PrefacePartsPanel`, and `cadenceOverrides` / `mergedBreaks` / `forcedBreaks` / `extraBreaks` keyed by `{ endWordIndex, wordText }`.

## 0.4.2

- **Preface body, solemn tone** (reading mode, built-in tones), derived from a complete setting of the Advent preface and checked against it: 196 of its 205 syllables come out identical. Punctuation chooses the cadence: `,` none, `;` `:` metrum, `.` the long cadence (with the "Per Christum Dóminum nostrum" lead-in when it fits); the last phrase always gets the long cadence. Not generated: the "Et ideo," figure, g-tenor phrases such as "quod vigilántes", and the "trá" flourish in "trámitem". Regression test: `tests/fixtures/advent-preface-body.txt`.
- Tone definition format: `reintone: yes` (repeat the intonation after ; : . ?), `?note` before the other prep notes (only used when the syllable before it is stressed) and `?note` / `?^note` in positional cadences (optional leading slots, with the trigger syllable marked ^), and `!` in notes.
- Still missing: the ferial (simple) preface body. It needs a sample setting like the solemn one.

## 0.4.1

- **Prophecy tone** added to the reading tones (flex on the last syllable of a phrase, full stop falling a fifth, interrogation, final formula ending on SI flat). Same source and same caveat as the epistle and gospel tones.
- **Preface dialogues:** the solemn and ferial (simple) preface tones, from "Per omnia saecula saeculorum" to "Dignum et iustum est", as fixed GABC (Tones panel, reading mode, "Preface dialogue"). Transcriptions from GregoBase (Liber Usualis p. 109, Graduale Romanum 1961 pp. 130*-131*).
- **Not included:** the preface body ("Vere dignum ... per Christum Dominum nostrum"). Its cadences were not available from a source I could verify.

## 0.4.0

- **Built-in psalm tones** (Tones panel, "Built-in tone"): tones 1-8 with every ending, solemn mediants, the antiquo / alt / monasticus variants, tonus peregrinus, irregularis and the in directum tones (18 families, 95 tone/ending combinations). Choosing one fills the definition box, so you can still edit the notes. The melodies come from the Source & Summit psalm-tone data, kept in `src/lib/tones/psalmTones.ts` in its original compact notation so it can be checked line by line.
- **Built-in reading tones:** Epistle (ancient tone with metrum, full stop, interrogation, pre-final and final formulas) and Gospel (full stop on the fourth syllable from the end, interrogation, final formula with quilisma). Formulas follow the Liber Usualis as described in the CMAA "Sung readings" tutorial. Titles and the closing dialogues are not generated.
- Tone definition format: cadences may now use flats and neume shapes (`ixi`, `gvFED.`, `hiwj`), start with `recite=<note>;` (recite the rest of the phrase on another note, as in the peregrinus second half and in questions) and/or `positional;` (notes laid on the last syllables regardless of stress). Reading tones accept `prefinal:` and `final:` and `none` for "recite here".
- Not included yet: the Introit tones and fixed-length endings with no accent (irregularis a, in directum monasticus), the versicle tones, the short mediant of tone 7, and the peregrinus variant whose second half begins with its own intonation.

## 0.3.0

- **Less clutter:** removed the separate neume palette strip (the ribbon already has every neume, division, clef and modifier), removed the duplicate Notation/Source switch, and folded the dark header bar into the ribbon's tab row (brand, save status, fullscreen, collapse). Fullscreen shows a small "Exit fullscreen" button.
- **Lyrics align to the first note:** each syllable is now centred under the first note of its cluster instead of the middle of the neume (canvas, PNG, PDF and the lyric edit box). Hyphens hang to the right so they don't pull the text off the note.
- **Tones panel (GABC editor, "Tones"):** paste Latin text and generate pointed GABC.
  - Psalm/canticle tones: intonation, flex (`†`, or automatic in long half-verses), mediant (`*`, or automatic split), termination, punctum cavum for proparoxytone endings, Gloria Patri, intonation on every verse.
  - Reading tones (epistle, gospel, prophecy, preface…): recite on the tenor with a cadence at each comma, colon/semicolon, full stop and question mark.
  - Latin stress detection: acute accents typed in the text win, then a small exception list, then the penultimate rule.
  - **No tone melodies are built in yet** - see README. Tones are defined in a small text format.

## 0.2.0

### Fixed / changed
- **GABC round-tripping is now lossless for untouched material.** Each parsed token remembers its original text; if you do not edit it, export emits it byte-for-byte (modifiers like `r`/`q`, `[...]` layout tags, `<alt>`/`<i>`/`<b>`/`<c>` markup, clefs such as `cb1`, division variants like `,0`, fused `(:z)` breaks, second `annotation:` line). Edited tokens are regenerated from the model.
- Rubric-red lyrics are written back as `<c>…</c>` when a token is regenerated.
- One serializer: the exported file and the editor's source view share the same code.
- The validator reports features the visual score cannot display (and comments that are dropped) as located warnings.
- PNG/PDF exports embed the web fonts they use (Google Fonts, latin subset) so text no longer falls back to a default serif. Falls back gracefully if offline.
- Heavy export libraries (jsPDF, JSZip, lamejs) load on demand.

### Added
- **Text → notes:** paste Latin text in the GABC panel (Text button); it is auto-syllabified (ecclesiastical rules, hyphens override) and placed on the notes for review before applying.
- **Save/Open Project** (`.chantscore.json`): includes fonts, page setup and colours that GABC cannot hold. Drop a project file on the workspace to open it.
- **Copy share link** (`#gabc=…`): opens the score on another browser; asks before replacing autosaved work.
- Versioned storage (`chantscore.project.v2`) with automatic migration of v1 saves; clearer message when saving fails.
- Keyboard: Left/Right arrows move the note selection; palette toggles expose `aria-pressed`; icon-only buttons get accessible names; notices are announced by screen readers.
- Unit tests (`npm test`, Node's built-in runner) and a CI workflow; deploy now runs tests and uses `npm ci`.

### Housekeeping
- Removed AI Studio template leftovers (`@google/genai`, `express`, `dotenv`, `tsx`, `.env.example`, banner) and renamed the package.
- Added `THIRD_PARTY_NOTICES.md`.
