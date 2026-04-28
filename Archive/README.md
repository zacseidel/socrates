# StrategyFractal

**StrategyFractal** is a single-page, browser-based strategy mapping tool for building nested outlines of topics, questions, answers, and sources — rendered as an interactive canvas.

No install, no build step, no backend. Host with GitHub Pages or open the file directly.

---

## Concept

Start with a topic. Branch it into questions. Answer each question. Each answer can itself branch into more questions — creating a fractal-style strategic outline.

```
Topic
└── Why?
    ├── Answer 1
    │   └── How?
    │       └── Answer 1.1
    └── Answer 2
        └── Who?
            └── Answer 2.1
```

Every answer can become the center of another layer of inquiry.

---

## Features

### Canvas board
- Questions radiate outward from each topic or answer on an arc layout
- Arc radius adjusts dynamically so expanded cards never overlap
- Free-drag repositioning for any question card (drag the `⠿` handle)
- **Arrange** button resets all cards to the auto-layout
- Pan (drag on empty canvas) and zoom (scroll wheel or pinch)

### Editing
- Create top-level topics
- Add `Why`, `What`, `How`, `Who`, and custom question branches — unlimited, including multiple of the same type
- Add and reorder answers within a question (drag via `⠿` handle)
- Add sources to any topic or answer (label, URL, notes)
- Delete individual branches or entire subtrees
- Duplicate a subtree as a new top-level topic

### Display
- Only the answer currently in focus shows question-branch prompts (no clutter)
- Lazy question branches: questions only enter the data model when used
- Outline tree in sidebar: only populated branches appear
- Search across all text, questions, and sources

### Persistence and portability
- Auto-save to `localStorage`
- Export / import full board state as **JSON**
- Export nested outline as **plain text** (breadth-first overview, then drill-down)
- Copy outline to clipboard

### Quality of life
- Undo / redo
- Reorder top-level topics by drag
- Hide/show the Top-Level Topics strip
- Hide/show the outline sidebar
- Four themes: Modern, Sticky Notes, Playful, Minimal
- Board view and Outline view

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `N` | New top-level topic |
| `Q` | Add custom question to selected card |
| `A` | Add answer to the active question branch |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + Y` | Redo (alternate) |
| `Escape` | Collapse all expanded cards / close modal |

---

## Data model

**Item** — a topic or an answer. Contains text, sources, and an ordered list of question branch IDs.

**Question** — belongs to one item. Has a label (e.g., "Why") and an ordered list of answer item IDs.

This is fully recursive: answers are items, items have questions, questions have answers.

### Export formats

**JSON** — full state snapshot including all items, questions, sources, and UI state. Use this to resume work later.

**Text** — breadth-first overview of siblings, then drill-down into each branch. Sources appear inline beneath each item.

---

## Deploying to GitHub Pages

1. Create a GitHub repository
2. Add `index.html`, `app.js`, `style.css` to the root
3. Push to GitHub
4. In repository settings → Pages, set source to the `main` branch, root folder
5. Open the published URL

---

## Design principles

- **Direct manipulation** — interact with cards on the canvas, not in a separate editor panel
- **Only show what is meaningful** — unused branches stay out of the tree and exports
- **Recursive structure** — every answer is a potential new layer of inquiry
- **Portable and lightweight** — no backend, no install, no build step
- **Readable exports** — the work should carry cleanly into documents and presentations

---

## Implementation

Three files, no dependencies:

- `index.html` — structure
- `style.css` — layout, themes, visual treatment
- `app.js` — all state management, rendering, layout, drag-and-drop, persistence, export

See `CLAUDE.md` for architecture details.

---

## Scope and limitations

- Single user, local browser storage only
- No real-time collaboration, cloud sync, or authentication
- No cross-links between unrelated branches
- No markdown export
