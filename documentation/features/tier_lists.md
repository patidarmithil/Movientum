# Tier Lists

Users rank titles or characters into rows (S, A, B, …), save the board, and share it with a public link.

## Pages

| Route | What it is |
|---|---|
| `/tierlist` | Template catalogue: 515 templates in 16 categories |
| `/tierlist/new` | Blank board |
| `/tierlist/t/:slug` | Board started from a template |
| `/tierlist/my/:id` | A saved board you own |
| `/tierlist/s/:shareId` | Someone's shared board (read-only, public) |

## Templates are recipes, not stored lists

`backend/app/data/tier_templates.py` describes each template as a pointer into TMDB, for example "this franchise collection", "this director's films", "this show's cast", "this season's episodes", or "your own library". There are ten source kinds.

- The catalogue page does **no** database or TMDB work: cover posters and item counts are baked into `data/tier_covers.py` and `data/tier_counts.py`.
- A template's items are resolved only when someone opens it (`tier_template_service.py`), then cached 7 days. Nothing is pre-warmed.
- Template ids are hand-written, so a typo gives an empty template. `backend/debug/scratch_tier_templates.py` checks every template against live TMDB; run it after editing templates (`--write-covers` regenerates covers).

## Characters

A board can rank a show's characters instead of titles. `character_service.py` picks the best source:

1. **AniList** — for Japanese animation.
2. **Fandom wiki** — for other animation (cartoons).
3. **TMDB cast** — for live action, and as the fallback when the others return nothing.

Browsing characters caches nothing; saving a board caches that show's characters for 7 days.

## Saving and sharing

- Stored in `tier_lists` as JSON: rows, unranked items, and `item_meta` (title and poster frozen at save time).
- Because of `item_meta`, a shared link renders with no TMDB call.
- Limits: 12 rows, 300 items, a per-user board cap.
- Guests' drafts autosave to `localStorage`; uploaded images stay in the browser (IndexedDB).

## Frontend details worth knowing

- **Dragging** is hand-written with Pointer Events (`hooks/useTierDrag.js`). HTML5 drag-and-drop does not work on touch screens, and the project avoids a drag library.
- **PNG export** draws the board on a canvas (`utils/tierExport.js`). Posters are loaded with `?cors=1` so the canvas is not blocked by cross-origin rules.
- Tiles are real buttons, so boards work from the keyboard.
