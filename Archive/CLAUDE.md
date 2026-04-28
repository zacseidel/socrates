# StrategyFractal — CLAUDE.md

Single-page vanilla JS canvas tool. No build step, no framework, no backend. Three files: `index.html`, `app.js`, `style.css`.

## Architecture

**Single IIFE in `app.js`**. All state, rendering, layout, drag, and persistence live here.

### State shape

```js
state = {
  roots: ['itemId', ...],              // ordered top-level topic IDs
  entities: {
    items: { [id]: Item },
    questions: { [id]: Question },
  },
  ui: {
    activeItemId,       // selected topic or answer
    activeQuestionId,   // open question branch
    canvas: { panX, panY, scale },
    sidebarOpen, topicsVisible, currentTheme, currentView
  },
  history: [...snapshots],
  future:  [...snapshots],
}
```

**Item** (topic or answer):
```js
{ id, kind, text, questionIds: [], parentQuestionId, sourceList: [], nodeMode, createdAt, updatedAt }
```

**Question**:
```js
{ id, label, parentItemId, answerIds: [], manualX, manualY }
```

`manualX`/`manualY` are set when user drags a question card. Absent = auto-layout.

### Render pipeline

1. `render()` — calls `renderRootLane()`, `renderCanvas()`, `renderOutline()`, `renderSidebar()`
2. `renderCanvas()` — calls `computeLayout()` to get `Map<id, {x,y,w,h}>`, then `renderItemNode()` + `renderQuestionNode()` for each entity, then `drawConnections()`
3. `computeLayout()` — calls `layoutSubtree()` recursively for each root item

### Arc layout engine

Constants:
```js
const HALF_SPREAD = Math.PI * 5 / 12;  // 75° fan
const ARC_R_MIN = 120;
const ROW_GAP = 16;
const NODE_W_TOPIC = 260;
const NODE_W_QUESTION = 280;
const ANSWER_H = 58;
```

`computeArcR(N, slotHeights)` — finds minimum radius so adjacent expanded slots don't collide:
```
R * (sin(a_{i+1}) - sin(a_i)) >= (slotH_i + slotH_{i+1}) / 2 + ROW_GAP
```

`layoutSubtree(itemId, depth, cy, layout)` — places each question at `(arcLeft, arcTop)` where:
```
arcTop = slotCenterY - slotH/2 + ROW_GAP   // card at slot top; expansion stays inside slot
```

Slot height:
```
slotH = max(computeQuestionBlockH(qId), estimateQuestionHeightExpanded(q) + ROW_GAP)
```

Expansion height is constant-overhead (only one focused bullet shows actions at a time via CSS `:focus-within`):
```js
estimateQuestionHeightExpanded(q) = estimateQuestionHeight(q) + 112
```

Answer bullet layout (connector anchoring — NOT slot center):
```js
bulletCenterY = qY + 56 + ai * ANSWER_H + ANSWER_H / 2
```

### Drag systems

Two separate systems coexist:

**1. HTML5 drag** (`dragState`) — answer bullet reordering within a question card, and root lane topic reordering.
- Bullets are always `draggable=true`; `dragstart` is gated on `.a-drag-handle` hit test
- Uses `dragState = { dragType, itemId, arrayRef }`

**2. Free canvas drag** (`nodeDragState`) — repositioning question nodes on the canvas.
- Pure mousedown/mousemove/mouseup on `.q-drag-handle`
- Stores `manualX`/`manualY` on the question entity
- `arrangeLayout()` clears all manual positions → triggers re-layout

**Canvas pan**: `isPanning` + `panStart`, activated on mousedown on empty canvas area.

### Mutation pattern

All state mutations follow:
```js
pushHistory();          // snapshot current state
// ... mutate state.entities ...
persist();              // save to localStorage
render();               // re-render
```

### Key functions

| Function | Purpose |
|----------|---------|
| `computeLayout()` | Entry point for layout; returns Map of positions |
| `layoutSubtree(itemId, depth, cy, layout)` | Recursive arc placement |
| `computeArcR(N, slotHeights)` | Minimum arc radius for no overlap |
| `estimateQuestionHeightExpanded(q)` | Predicted expanded card height for slot sizing |
| `renderItemNode(item, layout)` | Renders topic/answer card DOM node |
| `renderQuestionNode(q, pos)` | Renders question card DOM node |
| `drawConnections(layout)` | Draws SVG connector lines |
| `startNodeDrag(e, questionId, nodeEl, pos)` | Begins free canvas drag |
| `arrangeLayout()` | Clears manualX/Y, re-renders |
| `spawnQuestion(itemId, label)` | Creates question + pans canvas to show it |
| `deleteItemRecursive(itemId)` | Deletes item and all descendant questions/answers |
| `deleteQuestionRecursive(questionId, cleanParent)` | Deletes question branch; `cleanParent=true` removes from parent's `questionIds` |
| `pushHistory()` / `undo()` / `redo()` | State snapshot history |
| `persist()` | Serialize state to localStorage |
| `normalizeState(raw)` | Migrate/validate loaded state |
| `exportJSON()` / `importJSON(str)` | Full state export/import |
| `buildOutlineText(rootId)` | Generates plain-text export |

### CSS notes

- Bullet action visibility: `.answer-bullet:focus-within .answer-bullet-actions { display: flex; }` — only the focused bullet shows question prompts
- Themes: `body.theme-modern`, `body.theme-sticky`, `body.theme-playful`, `body.theme-minimal`
- Canvas: `.canvas-viewport` clips, `.canvas-world` is the transformed layer

## Common changes

**Add a new question type**: Questions are created with arbitrary `label` strings via `spawnQuestion(itemId, label)`. The orbit buttons are hardcoded in `renderItemNode`. Add a button there; no schema change needed.

**Change fan angle**: Adjust `HALF_SPREAD`. `Math.PI * 5/12` = 75°.

**Change expansion buffer**: Edit `estimateQuestionHeightExpanded`. The `+ 112` = footer (~44px) + one focused bullet's action row (~68px).

**Change connector line style**: `drawConnections()` in `app.js`; uses SVG `<path>` with cubic bezier.

**Change auto-layout spacing**: `ROW_GAP` constant (currently 16px).
