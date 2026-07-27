import {
  findTreeMatches,
  getChildTargets,
  getFocusContext,
  moveChildInState,
  targetExists,
  targetLabel,
} from './tree-model.js';

(function() {
  const STORAGE_KEY = 'strategyfractal-state-v3';
  const LEGACY_STORAGE_KEYS = ['strategyfractal-state-v2', 'strategyfractal-state-v1'];
  const DEFAULT_QUESTIONS = ['Why', 'What', 'How', 'Who'];
  const THEMES = ['modern', 'sticky', 'playful', 'minimal'];
  const ZOOM_MIN = 0.12;
  const ZOOM_MAX = 2.0;
  const HALF_SPREAD = Math.PI * 5 / 12; // 75° fan, ~1 o'clock to ~5 o'clock
  const ARC_R_MIN = 120;
  const ROW_GAP = 16;
  const NODE_W_TOPIC = 300;
  const NODE_W_QUESTION = 340;

  const els = {
    workspace: document.getElementById('workspace'),
    outlineText: document.getElementById('outlineText'),
    selectionPill: document.getElementById('selectionPill'),
    boardView: document.getElementById('boardView'),
    focusView: document.getElementById('focusView'),
    focusBreadcrumbs: document.getElementById('focusBreadcrumbs'),
    focusContext: document.getElementById('focusContext'),
    focusCurrent: document.getElementById('focusCurrent'),
    focusChildren: document.getElementById('focusChildren'),
    canvasWorld: document.getElementById('canvasWorld'),
    connectionLayer: document.getElementById('connectionLayer'),
    toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
    collapseSidebarInnerBtn: document.getElementById('collapseSidebarInnerBtn'),
    sidebarBackdrop: document.getElementById('sidebarBackdrop'),
    boardViewBtn: document.getElementById('boardViewBtn'),
    focusViewBtn: document.getElementById('focusViewBtn'),
    undoBtn: document.getElementById('undoBtn'),
    redoBtn: document.getElementById('redoBtn'),
    searchInput: document.getElementById('searchInput'),
    searchResults: document.getElementById('searchResults'),
    copyOutlineBtn: document.getElementById('copyOutlineBtn'),
    downloadTextBtn: document.getElementById('downloadTextBtn'),
    modalBackdrop: document.getElementById('modalBackdrop'),
    modalTitle: document.getElementById('modalTitle'),
    modalSubtitle: document.getElementById('modalSubtitle'),
    modalTextarea: document.getElementById('modalTextarea'),
    modalActions: document.getElementById('modalActions'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    resetZoomBtn: document.getElementById('resetZoomBtn'),
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
    zoomFitBtn: document.getElementById('zoomFitBtn'),
    actionsBtn: document.getElementById('actionsBtn'),
    actionsDropdown: document.getElementById('actionsDropdown'),
    orderBackdrop: document.getElementById('orderBackdrop'),
    orderSheet: document.getElementById('orderSheet'),
    orderSheetTitle: document.getElementById('orderSheetTitle'),
    orderSheetSubtitle: document.getElementById('orderSheetSubtitle'),
    orderList: document.getElementById('orderList'),
    closeOrderSheetBtn: document.getElementById('closeOrderSheetBtn'),
    openSelectedInFocusBtn: document.getElementById('openSelectedInFocusBtn'),
    saveIndicator: document.getElementById('saveIndicator'),
    appToast: document.getElementById('appToast'),
  };

  const phoneMedia = window.matchMedia('(max-width: 767px)');
  let loadedFromLegacyStorage = false;
  let state = loadState() || createInitialState();
  let dragState = null;
  let toastTimer = null;
  let canvasPersistTimer = null;
  let examplesManifest = null;
  let isPanning = false;
  let panStart = { x: 0, y: 0 };
  let nodeDragState = null; // free-position canvas drag for question nodes
  let orderSheetParent = null;
  let lastDialogTrigger = null;
  let lastSidebarTrigger = null;
  let suppressNextHistoryFocus = false;
  const measuredNodeHeights = new Map();
  let measurementRenderPending = false;

  // ── Initial state ─────────────────────────────────────────────────────────

  function createInitialState() {
    const s = {
      version: 3,
      settings: {
        theme: 'modern',
        mainView: phoneMedia.matches ? 'focus' : 'board',
        sidebarOpen: false,
        showTopTopics: true,
      },
      ui: {
        selectedItemId: null,
        activeQuestionId: null,
        search: '',
        canvas: { panX: 60, panY: 60, scale: 1.0 },
        phoneCanvas: { panX: 24, panY: 24, scale: 0.8 },
        focusTarget: null,
      },
      roots: [],
      entities: {
        items: {},
        questions: {},
      },
      history: {
        past: [],
        future: [],
      },
      meta: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastSavedAt: Date.now(),
      }
    };
    const first = createItemInternal(s, { kind: 'topic', text: '' });
    s.roots.push(first.id);
    s.ui.selectedItemId = first.id;
    s.ui.focusTarget = { kind: 'item', id: first.id };
    return s;
  }

  // ── Entity creation ───────────────────────────────────────────────────────

  function uid(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  function createItemInternal(targetState, { kind = 'answer', text = '', parentQuestionId = null } = {}) {
    const id = uid('item');
    targetState.entities.items[id] = {
      id,
      kind,
      text,
      questionIds: [],
      parentQuestionId,
      sourceList: [],
      nodeMode: 'expanded',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (parentQuestionId) {
      const q = targetState.entities.questions[parentQuestionId];
      if (q) q.answerIds.push(id);
    }
    return targetState.entities.items[id];
  }

  function createQuestionInternal(targetState, parentItemId, label = '') {
    const id = uid('q');
    targetState.entities.questions[id] = {
      id,
      parentItemId,
      label,
      answerIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    targetState.entities.items[parentItemId].questionIds.push(id);
    return targetState.entities.questions[id];
  }

  // ── History / persistence ─────────────────────────────────────────────────

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function snapshotState() {
    return deepClone({
      settings: state.settings,
      ui: state.ui,
      roots: state.roots,
      entities: state.entities,
      meta: state.meta,
    });
  }

  function pushHistory() {
    state.history.past.push(snapshotState());
    if (state.history.past.length > 80) state.history.past.shift();
    state.history.future = [];
  }

  function restoreSnapshot(snapshot) {
    state.settings = snapshot.settings;
    state.ui = snapshot.ui;
    state.roots = snapshot.roots;
    state.entities = snapshot.entities;
    state.meta = snapshot.meta || state.meta;
    normalizeState();
    render();
    persist();
  }

  function normalizeState() {
    if (!state.settings) state.settings = { theme: 'modern', mainView: 'board', sidebarOpen: true, showTopTopics: true };
    if (state.settings.mainView === 'outline') state.settings.mainView = 'focus';
    if (!['board', 'focus'].includes(state.settings.mainView)) state.settings.mainView = 'board';
    if (typeof state.settings.showTopTopics !== 'boolean') state.settings.showTopTopics = true;
    if (!state.ui) state.ui = { selectedItemId: null, activeQuestionId: null, search: '', canvas: { panX: 60, panY: 60, scale: 1.0 } };
    if (!state.ui.canvas) state.ui.canvas = { panX: 60, panY: 60, scale: 1.0 };
    if (!state.ui.phoneCanvas) state.ui.phoneCanvas = { panX: 24, panY: 24, scale: 0.8 };
    if (!state.history) state.history = { past: [], future: [] };
    if (!state.entities) state.entities = { items: {}, questions: {} };
    if (!Array.isArray(state.roots)) state.roots = [];

    state.roots = state.roots.filter(id => state.entities.items[id]);
    if (!state.roots.length) {
      const fallback = createItemInternal(state, { kind: 'topic', text: '' });
      state.roots.push(fallback.id);
    }

    Object.values(state.entities.items).forEach(item => {
      if (!Array.isArray(item.questionIds)) item.questionIds = [];
      if (!Array.isArray(item.sourceList)) item.sourceList = [];
      item.sourceList.forEach(source => {
        if (!source.id) source.id = uid('src');
      });
      if (!item.nodeMode) item.nodeMode = 'collapsed';
    });
    Object.values(state.entities.questions).forEach(q => {
      if (!Array.isArray(q.answerIds)) q.answerIds = [];
    });

    if (!state.entities.items[state.ui.selectedItemId]) {
      state.ui.selectedItemId = state.roots[0] || null;
    }
    if (!targetExists(state, state.ui.focusTarget)) {
      state.ui.focusTarget = state.ui.selectedItemId
        ? { kind: 'item', id: state.ui.selectedItemId }
        : state.roots[0]
          ? { kind: 'item', id: state.roots[0] }
          : null;
    }
    state.version = 3;
  }

  function undo() {
    if (!state.history.past.length) return;
    const current = snapshotState();
    const prev = state.history.past.pop();
    state.history.future.push(current);
    restoreSnapshot(prev);
  }

  function redo() {
    if (!state.history.future.length) return;
    const current = snapshotState();
    const next = state.history.future.pop();
    state.history.past.push(current);
    restoreSnapshot(next);
  }

  function persist() {
    state.meta.updatedAt = Date.now();
    state.meta.lastSavedAt = Date.now();
    const payload = deepClone(state);
    delete payload.history;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      if (els.saveIndicator) els.saveIndicator.textContent = 'Saved locally';
    } catch (err) {
      console.warn('Failed to save state:', err);
      if (els.selectionPill) flash('Local save failed. Export a backup.');
    }
  }

  let persistTimer = null;
  // Coalesce rapid writes (e.g. typing in a source field or the search box)
  // so we don't serialize the whole board on every keystroke.
  function schedulePersist(delay = 400) {
    clearTimeout(persistTimer);
    if (els.saveIndicator) els.saveIndicator.textContent = 'Saving…';
    persistTimer = setTimeout(persist, delay);
  }

  function loadState() {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        raw = LEGACY_STORAGE_KEYS.map(key => localStorage.getItem(key)).find(Boolean);
        loadedFromLegacyStorage = Boolean(raw);
      }
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.entities || !parsed.roots) return null;
      if (!parsed.history) parsed.history = { past: [], future: [] };
      if (!parsed.settings) parsed.settings = { theme: 'modern', mainView: 'board', sidebarOpen: true, showTopTopics: true };
      if (typeof parsed.settings.showTopTopics !== 'boolean') parsed.settings.showTopTopics = true;
      if (!parsed.ui) parsed.ui = { selectedItemId: parsed.roots[0] || null, activeQuestionId: null, search: '', canvas: { panX: 60, panY: 60, scale: 1.0 } };
      if (!parsed.ui.canvas) parsed.ui.canvas = { panX: 60, panY: 60, scale: 1.0 };
      return parsed;
    } catch (err) {
      console.warn('Failed to load state:', err);
      return null;
    }
  }

  // ── State helpers ─────────────────────────────────────────────────────────

  function normalizeLabel(label) {
    return (label || '').trim().toLowerCase();
  }

  function colorClassForLabel(label) {
    const value = normalizeLabel(label);
    if (!value) return 'blank';
    if (value === 'why') return 'why';
    if (value === 'what') return 'what';
    if (value === 'how') return 'how';
    if (value === 'who') return 'who';
    return 'custom';
  }

  function itemLabel(item) {
    const text = (item?.text || '').trim();
    return text || (item?.kind === 'topic' ? 'Untitled topic' : 'Untitled answer');
  }

  function getSelectedItem() {
    return state.entities.items[state.ui.selectedItemId] || null;
  }

  function setFocusedNode(itemId) {
    const prev = state.entities.items[state.ui.selectedItemId];
    if (prev && prev.id !== itemId) prev.nodeMode = 'collapsed';
    state.ui.selectedItemId = itemId;
    persist();
    renderCanvas();
    renderOutlineText();
    updateButtons();
  }

  function setFocusTarget(target, { switchView = false } = {}) {
    if (!targetExists(state, target)) return;
    state.ui.focusTarget = { kind: target.kind, id: target.id };
    if (target.kind === 'item') {
      state.ui.selectedItemId = target.id;
      state.ui.activeQuestionId = state.entities.items[target.id]?.parentQuestionId || null;
    } else {
      const question = state.entities.questions[target.id];
      state.ui.activeQuestionId = target.id;
      state.ui.selectedItemId = question?.parentItemId || state.ui.selectedItemId;
    }
    if (switchView) state.settings.mainView = 'focus';
    persist();
    render();
    requestAnimationFrame(() => {
      focusWithoutHistory(els.focusCurrent?.querySelector('textarea, input'), { preventScroll: true });
    });
  }

  function setExpandedNode(itemId, mode) {
    const item = state.entities.items[itemId];
    if (!item) return;
    item.nodeMode = mode;
    persist();
    renderCanvas();
  }

  // ── Meaningful-content helpers ────────────────────────────────────────────

  function filterMatchesItem(item) {
    const query = (state.ui.search || '').trim().toLowerCase();
    if (!query) return true;
    return findTreeMatches(state, query).visible.has(`item:${item.id}`);
  }

  function searchAllows(kind, id) {
    const query = (state.ui.search || '').trim();
    if (!query) return true;
    return findTreeMatches(state, query).visible.has(`${kind}:${id}`);
  }

  function hasDirectItemContent(item) {
    if (!item) return false;
    return Boolean((item.text || '').trim()) || item.sourceList.some(src => Boolean((src.label || '').trim() || (src.url || '').trim() || (src.note || '').trim()));
  }

  function isItemMeaningful(item) {
    if (!item) return false;
    if (hasDirectItemContent(item)) return true;
    return item.questionIds.some(qid => isQuestionMeaningful(state.entities.questions[qid]));
  }

  function isQuestionMeaningful(question) {
    if (!question) return false;
    const answers = question.answerIds.map(id => state.entities.items[id]).filter(Boolean);
    return answers.some(answer => isItemMeaningful(answer));
  }

  function meaningfulQuestionsForItem(item) {
    const searching = Boolean((state.ui.search || '').trim());
    return item.questionIds
      .map(id => state.entities.questions[id])
      .filter(q => q && (searching ? searchAllows('question', q.id) : isQuestionMeaningful(q)));
  }

  function meaningfulAnswersForQuestion(question) {
    const searching = Boolean((state.ui.search || '').trim());
    return question.answerIds
      .map(id => state.entities.items[id])
      .filter(answer => answer && (searching ? searchAllows('item', answer.id) : isItemMeaningful(answer)));
  }

  // ── Layout engine ─────────────────────────────────────────────────────────

  function estimateItemHeight(item) {
    if (!item) return 44;
    if (measuredNodeHeights.has(item.id)) return measuredNodeHeights.get(item.id);
    if (item.nodeMode === 'collapsed') return 40;
    const srcH = item.sourceList.length * 64;
    return 90 + srcH;
  }

  function estimateQuestionHeight(question) {
    if (!question) return 44;
    if (measuredNodeHeights.has(question.id)) return measuredNodeHeights.get(question.id);
    const answerCount = Math.max(1, question.answerIds.length);
    return 56 + answerCount * 58;
  }

  // Height when card is expanded (active): footer ~44px + one focused bullet's
  // actions ~68px. Only one bullet shows actions at a time (:focus-within),
  // so the overhead is constant regardless of answer count.
  function estimateQuestionHeightExpanded(question) {
    if (!question) return 120;
    return estimateQuestionHeight(question) + 112;
  }

  const ANSWER_H = 58; // matches estimateQuestionHeight per-answer increment

  function topicNodeWidth() {
    return phoneMedia.matches
      ? Math.max(240, Math.min(NODE_W_TOPIC, els.boardView.clientWidth - 32))
      : NODE_W_TOPIC;
  }

  function questionNodeWidth() {
    return phoneMedia.matches
      ? Math.max(260, Math.min(NODE_W_QUESTION, els.boardView.clientWidth - 24))
      : NODE_W_QUESTION;
  }

  // Total vertical space needed by all sub-questions hanging off an item.
  function computeFullSubtreeH(itemId) {
    const item = state.entities.items[itemId];
    if (!item || !item.questionIds.length) return 0;
    const N = item.questionIds.length;
    return item.questionIds.reduce((total, qId, i) => {
      return total + computeQuestionBlockH(qId) + (i < N - 1 ? ROW_GAP : 0);
    }, 0);
  }

  // Vertical space a question "block" needs: max of its card height and the
  // sum of slots required by each answer's sub-tree.
  function computeQuestionBlockH(questionId) {
    const q = state.entities.questions[questionId];
    if (!q) return 0;
    const qH = estimateQuestionHeight(q);
    if (!q.answerIds.length) return qH;
    const ansTotal = q.answerIds.reduce((s, aid, i) => {
      return s + Math.max(computeFullSubtreeH(aid), ANSWER_H) + (i < q.answerIds.length - 1 ? ROW_GAP : 0);
    }, 0);
    return Math.max(qH, ansTotal);
  }

  // Minimum arc radius so adjacent expanded slots never collide.
  function computeArcR(N, slotHeights) {
    if (N <= 1) return ARC_R_MIN;
    const Da = 2 * HALF_SPREAD / (N - 1);
    let minR = ARC_R_MIN;
    for (let i = 0; i < N - 1; i++) {
      const a = -HALF_SPREAD + i * Da;
      const ds = Math.sin(a + Da) - Math.sin(a);
      if (ds <= 0) continue;
      const need = (slotHeights[i] + slotHeights[i + 1]) / 2 + ROW_GAP;
      minR = Math.max(minR, need / ds);
    }
    return minR;
  }

  function computeLayout() {
    const layout = new Map();
    let arcBottom = 60;

    state.roots.forEach(rootId => {
      const item = state.entities.items[rootId];
      if (!item) return;
      const h = estimateItemHeight(item);
      const N = item.questionIds.filter(qId => state.entities.questions[qId]).length;

      if (N === 0) {
        layout.set(rootId, { x: 60, y: arcBottom, w: topicNodeWidth(), h });
        arcBottom += h + ROW_GAP * 3;
        return;
      }

      const slotHeights = item.questionIds.map(qId => {
        const q = state.entities.questions[qId];
        const expandedH = q ? estimateQuestionHeightExpanded(q) : 0;
        return Math.max(computeQuestionBlockH(qId), expandedH + ROW_GAP);
      });
      const R = computeArcR(N, slotHeights);
      const arcTopExt = R * Math.sin(HALF_SPREAD) + (slotHeights[0] || 0) / 2;
      const cy = arcBottom + ROW_GAP * 3 + arcTopExt;
      const y = cy - h / 2;
      layout.set(rootId, { x: 60, y, w: topicNodeWidth(), h });
      layoutSubtree(rootId, 0, y, layout);
      const arcBotExt = R * Math.sin(HALF_SPREAD) + (slotHeights[N - 1] || 0) / 2;
      arcBottom = cy + arcBotExt;
    });

    return layout;
  }

  function layoutSubtree(itemId, depth, startY, layout) {
    const item = state.entities.items[itemId];
    if (!item || !item.questionIds.length) return 0;

    const parentPos = layout.get(itemId);
    if (!parentPos) return 0;

    const N = item.questionIds.length;
    const cx = parentPos.x + parentPos.w;
    const cy = parentPos.y + parentPos.h / 2;

    const slotHeights = item.questionIds.map(qId => {
      const q = state.entities.questions[qId];
      const expandedH = q ? estimateQuestionHeightExpanded(q) : 0;
      return Math.max(computeQuestionBlockH(qId), expandedH + ROW_GAP);
    });
    const R = computeArcR(N, slotHeights);

    item.questionIds.forEach((questionId, i) => {
      const q = state.entities.questions[questionId];
      if (!q) return;
      const slotH = slotHeights[i];
      const qH = estimateQuestionHeight(q);

      const angle = N === 1 ? 0 : -HALF_SPREAD + i * 2 * HALF_SPREAD / (N - 1);
      const slotCenterY = cy + R * Math.sin(angle);
      const arcLeft = cx + R * Math.cos(angle);
      const arcTop  = slotCenterY - slotH / 2 + ROW_GAP; // top-of-slot + gap, room for bottom expansion
      const qX = (q.manualX !== undefined) ? q.manualX : arcLeft;
      const qY = (q.manualY !== undefined) ? q.manualY : arcTop;

      layout.set(questionId, { x: qX, y: qY, w: questionNodeWidth(), h: qH });

      // Place each answer's layout slot so its center matches the bullet's
      // visual position inside the question card. The card header occupies
      // the first 56px (matches estimateQuestionHeight base); each bullet is
      // ANSWER_H tall. This makes connector lines and sub-question arcs
      // originate from the correct visual location.
      q.answerIds.forEach((answerId, ai) => {
        const answer = state.entities.items[answerId];
        if (!answer) return;
        const ansSubH = computeFullSubtreeH(answerId);
        const ansSlotH = Math.max(ansSubH, ANSWER_H);
        const bulletCenterY = qY + 56 + ai * ANSWER_H + ANSWER_H / 2;
        layout.set(answerId, { x: qX, y: bulletCenterY - ansSlotH / 2, w: questionNodeWidth(), h: ansSlotH, inline: true });
        if (ansSubH > 0) layoutSubtree(answerId, depth + 1, 0, layout);
      });
    });

    const botAngle = N === 1 ? 0 : HALF_SPREAD;
    const lastSlotH = slotHeights[N - 1] || 0;
    const arcBot = cy + R * Math.sin(botAngle) + lastSlotH / 2;
    return Math.max(arcBot - parentPos.y, 0);
  }

  // ── Canvas rendering ──────────────────────────────────────────────────────

  function renderCanvas() {
    if (state.settings.mainView !== 'board') return;
    const layout = computeLayout();
    syncCanvasNodes(layout);
    renderConnections(layout);
    applyTransform();
    updateFidelityClass();
  }

  function syncCanvasNodes(layout) {
    const query = (state.ui.search || '').trim();
    const searchIndex = query ? findTreeMatches(state, query) : null;
    // Remove orphaned nodes
    Array.from(els.canvasWorld.querySelectorAll('[data-node-id]')).forEach(el => {
      const id = el.dataset.nodeId;
      if (!layout.has(id)) el.remove();
    });

    // Create or update nodes
    layout.forEach((pos, id) => {
      if (pos.inline) return; // answer items rendered inside question nodes

      const isItem = Boolean(state.entities.items[id]);
      const isQuestion = Boolean(state.entities.questions[id]);
      if (!isItem && !isQuestion) return;

      let nodeEl = els.canvasWorld.querySelector(`[data-node-id="${id}"]`);
      if (!nodeEl) {
        nodeEl = document.createElement('div');
        nodeEl.className = 'node';
        nodeEl.dataset.nodeId = id;
        els.canvasWorld.appendChild(nodeEl);
      } else {
        // Clone to shed any stale event listeners before re-rendering
        const fresh = nodeEl.cloneNode(false);
        nodeEl.replaceWith(fresh);
        nodeEl = fresh;
      }

      nodeEl.style.left = pos.x + 'px';
      nodeEl.style.top = pos.y + 'px';
      nodeEl.style.width = pos.w + 'px';
      if (query) {
        const kind = isItem ? 'item' : 'question';
        nodeEl.classList.toggle('search-match', searchIndex.matches.has(`${kind}:${id}`));
        nodeEl.classList.toggle('search-muted', !searchIndex.visible.has(`${kind}:${id}`));
      } else {
        nodeEl.classList.remove('search-match', 'search-muted');
      }

      if (isItem) {
        renderItemNode(nodeEl, state.entities.items[id]);
      } else {
        renderQuestionNode(nodeEl, state.entities.questions[id]);
        const q = state.entities.questions[id];
        if (q) {
          const handle = nodeEl.querySelector('.q-drag-handle');
          if (handle && !phoneMedia.matches) {
            handle.addEventListener('pointerdown', e => startNodeDrag(e, q.id, nodeEl, pos));
          }
        }
      }

      if (phoneMedia.matches) {
        const target = isItem ? { kind: 'item', id } : { kind: 'question', id };
        nodeEl.tabIndex = 0;
        nodeEl.setAttribute('role', 'button');
        nodeEl.setAttribute('aria-label', `${targetLabel(state, target)}. Select to open in Focus.`);
        nodeEl.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          nodeEl.click();
        });
      } else {
        nodeEl.removeAttribute('tabindex');
        nodeEl.removeAttribute('role');
        nodeEl.removeAttribute('aria-label');
      }

      const renderedHeight = nodeEl.firstElementChild?.offsetHeight || nodeEl.offsetHeight;
      if (canvasState().scale >= 0.6 && renderedHeight > 0 && Math.abs((measuredNodeHeights.get(id) || 0) - renderedHeight) > 1) {
        measuredNodeHeights.set(id, renderedHeight);
        if (!measurementRenderPending) {
          measurementRenderPending = true;
          requestAnimationFrame(() => {
            measurementRenderPending = false;
            renderCanvas();
          });
        }
      }
    });
  }

  function renderItemNode(nodeEl, item) {
    const isSelected = state.ui.selectedItemId === item.id;
    const isExpanded = item.nodeMode === 'expanded';
    const dotColor = '#94a3b8';

    const chipActive = isSelected ? 'is-active' : '';
    const rootIndex = state.roots.indexOf(item.id);
    const orderBadge = rootIndex >= 0 && state.roots.length > 1
      ? `<span class="node-order-badge" aria-label="Position ${rootIndex + 1}">${rootIndex + 1}</span>`
      : '';
    const boardReadOnly = phoneMedia.matches;

    if (!isExpanded) {
      nodeEl.innerHTML = `
        <div class="node-dot" style="background:${dotColor};"></div>
        <div class="node-topic-chip ${chipActive}" data-action="expand">
          ${orderBadge}
          <span>${escapeHtml(itemLabel(item))}</span>
        </div>
      `;
    } else {
      // Build spawn buttons for the default question types
      const spawnBtns = DEFAULT_QUESTIONS.map(label => {
        const cls = colorClassForLabel(label);
        return `<button type="button" class="spawn-btn ${cls}" data-spawn="${escapeHtml(label)}" title="Add ${escapeHtml(label)} branch">${escapeHtml(label)}</button>`;
      }).join('');

      const sourceHtml = buildSourceEditorHtml(item);

      nodeEl.innerHTML = `
        <div class="node-dot" style="background:${dotColor};"></div>
        <div class="node-topic-card ${chipActive}">
          <div class="node-card-header">
            ${orderBadge}
            <div class="node-chrome" style="display:flex;gap:6px;align-items:center;">
              <button type="button" class="soft" style="padding:5px 10px;font-size:0.78rem;" data-action="collapse">Collapse</button>
              <button type="button" class="soft" style="padding:5px 10px;font-size:0.78rem;" data-action="delete-item">Delete</button>
            </div>
          </div>
          <div class="node-card-body">
            <div class="node-text-area" contenteditable="${boardReadOnly ? 'false' : 'true'}" spellcheck="true" data-item-text="${item.id}"></div>
            <div class="node-question-buttons">
              ${spawnBtns}
              <button type="button" class="spawn-btn custom" data-spawn-custom="1">+ Custom</button>
            </div>
            <div class="inline-sources" data-source-mount="${item.id}">${sourceHtml}</div>
            <div class="node-chrome" style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="soft" style="padding:5px 10px;font-size:0.78rem;" data-action="add-source">+ Source</button>
              ${item.questionIds.length > 1 ? '<button type="button" class="soft" style="padding:5px 10px;font-size:0.78rem;" data-action="order-children">Order questions</button>' : ''}
            </div>
          </div>
        </div>
      `;

      const textEl = nodeEl.querySelector(`[data-item-text="${item.id}"]`);
      setEditableContent(textEl, item.text, 'What\'s the topic?');
      if (!boardReadOnly) {
        attachEditable(textEl, value => updateItemText(item.id, value), pushHistoryOnce);
        textEl.addEventListener('focus', () => { state.ui.focusTarget = { kind: 'item', id: item.id }; });
      }
    }

    nodeEl.onclick = e => handleItemNodeClick(e, item);
    wireSourceListeners(nodeEl, item);
  }

  function renderQuestionNode(nodeEl, question) {
    const item = state.entities.items[question.parentItemId];
    const cc = colorClassForLabel(question.label);
    const isActive = state.ui.activeQuestionId === question.id;
    const activeClass = isActive ? 'is-active' : '';
    const parent = state.entities.items[question.parentItemId];
    const orderIndex = Math.max(0, parent?.questionIds.indexOf(question.id) ?? 0);
    const boardReadOnly = phoneMedia.matches;

    // Dot color based on question type
    const dotColors = { why: '#ef476f', what: '#118ab2', how: '#06d6a0', who: '#f4a261', custom: '#8f7cf6', blank: '#94a3b8' };
    const dotColor = dotColors[cc] || '#94a3b8';

    // Build answer bullets
    const answersHtml = question.answerIds.map((answerId, bulletIndex) => {
      const answer = state.entities.items[answerId];
      if (!answer) return '';

      const childSpawnBtns = DEFAULT_QUESTIONS.map(label => {
        const bcls = colorClassForLabel(label);
        return `<button type="button" class="branch-spawn-btn ${bcls}" data-child-spawn="${escapeHtml(label)}" data-answer-id="${answerId}" title="Branch ${escapeHtml(label)}">${escapeHtml(label)} →</button>`;
      }).join('');

      return `
        <div class="answer-bullet" data-answer-id="${answerId}">
          <div class="answer-bullet-row">
            <div class="drag a-drag-handle" title="Drag to reorder answer" aria-hidden="${boardReadOnly ? 'true' : 'false'}">⋮⋮</div>
            <span class="node-order-badge answer-order-badge" aria-label="Answer position ${bulletIndex + 1}">${bulletIndex + 1}</span>
            <div class="bullet-marker"></div>
            <div class="answer-text-field" contenteditable="${boardReadOnly ? 'false' : 'true'}" spellcheck="true" data-item-text="${answer.id}"></div>
          </div>
          <div class="answer-bullet-actions node-chrome">
            ${childSpawnBtns}
            <button type="button" class="branch-spawn-btn custom" data-child-spawn-custom="1" data-answer-id="${answerId}">Custom →</button>
            <button type="button" class="branch-spawn-btn" style="color:var(--muted);" data-delete-answer="${answerId}" aria-label="Delete answer">✕</button>
          </div>
        </div>
      `;
    }).join('');

    // Offer split button if single answer with newlines
    const singleAnswer = question.answerIds.length === 1 ? state.entities.items[question.answerIds[0]] : null;
    const canSplit = singleAnswer && (singleAnswer.text || '').includes('\n') && singleAnswer.text.split('\n').filter(l => l.trim()).length > 1;

    nodeEl.innerHTML = `
      <div class="node-dot" style="background:${dotColor};"></div>
      <div class="node-question-card ${activeClass}">
        <div class="node-q-header">
          <div class="drag q-drag-handle" title="Move question card">⋮⋮</div>
          <span class="node-order-badge" aria-label="Question position ${orderIndex + 1}">${orderIndex + 1}</span>
          <div class="node-q-label" contenteditable="${boardReadOnly ? 'false' : 'true'}" spellcheck="false" data-question-label="${question.id}"></div>
          <div class="node-chrome" style="display:flex;gap:4px;flex-shrink:0;">
            <button type="button" class="soft" style="padding:4px 8px;font-size:0.75rem;" data-action="delete-question" aria-label="Delete question">✕</button>
          </div>
        </div>
        <div class="node-q-body">
          ${answersHtml || '<div class="branch-empty" style="font-size:0.84rem;">No answers yet.</div>'}
        </div>
        <div class="node-q-footer node-chrome">
          <button type="button" class="soft" style="padding:5px 10px;font-size:0.78rem;" data-action="add-answer">+ Answer</button>
          ${question.answerIds.length > 1 ? '<button type="button" class="soft" style="padding:5px 10px;font-size:0.78rem;" data-action="order-children">Order answers</button>' : ''}
          ${canSplit ? `<button type="button" class="soft split-btn" data-action="split-bullets">Split into bullets</button>` : ''}
        </div>
      </div>
    `;

    // Wire question label editable
    const labelEl = nodeEl.querySelector(`[data-question-label="${question.id}"]`);
    if (labelEl) {
      setEditableContent(labelEl, question.label, 'Question…');
      if (!boardReadOnly) {
        attachEditable(labelEl, value => updateQuestionLabel(question.id, value), pushHistoryOnce);
        labelEl.addEventListener('focus', () => { state.ui.focusTarget = { kind: 'question', id: question.id }; });
      }
    }

    // Wire answer text editables and bullet drag-to-reorder
    question.answerIds.forEach(answerId => {
      const answer = state.entities.items[answerId];
      if (!answer) return;
      const textEl = nodeEl.querySelector(`[data-item-text="${answer.id}"]`);
      if (textEl) {
        setEditableContent(textEl, answer.text, 'Write an answer…');
        if (!boardReadOnly) attachEditable(textEl, value => updateItemText(answerId, value), pushHistoryOnce);
      }
      const bulletEl = nodeEl.querySelector(`.answer-bullet[data-answer-id="${answerId}"]`);
      if (bulletEl) {
        if (textEl) {
          textEl.addEventListener('focus', () => {
            state.ui.focusTarget = { kind: 'item', id: answer.id };
            nodeEl.querySelectorAll('.answer-bullet').forEach(b => b.classList.remove('answer-active'));
            bulletEl.classList.add('answer-active');
          });
          textEl.addEventListener('blur', () => {
            setTimeout(() => {
              if (!bulletEl.contains(document.activeElement)) {
                bulletEl.classList.remove('answer-active');
              }
            }, 0);
          });
        }
        // Keep focus in the answer field when the branch/delete buttons are
        // pressed. Buttons don't take focus on click in Safari/Firefox, so
        // without this the field blurs and the actions hide (display:none)
        // before the click lands, swallowing the spawn/delete.
        const actionsEl = bulletEl.querySelector('.answer-bullet-actions');
        if (actionsEl) actionsEl.addEventListener('mousedown', e => e.preventDefault());
        const dragType = 'a-' + question.id;
        bulletEl.dataset.dragType = dragType;
        bulletEl.draggable = !boardReadOnly;
        bulletEl.addEventListener('dragstart', e => {
          if (!e.target.closest('.a-drag-handle')) { e.preventDefault(); return; }
          e.stopPropagation();
          dragState = { dragType, itemId: answerId, arrayRef: question.answerIds };
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', answerId);
          bulletEl.classList.add('dragging');
        });
        bulletEl.addEventListener('dragend', e => {
          e.stopPropagation();
          dragState = null;
          bulletEl.classList.remove('dragging');
        });
        bulletEl.addEventListener('dragover', e => {
          if (!dragState || dragState.dragType !== dragType) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
        });
        bulletEl.addEventListener('drop', e => {
          if (!dragState || dragState.dragType !== dragType) return;
          e.preventDefault();
          e.stopPropagation();
          const from = question.answerIds.indexOf(dragState.itemId);
          const to = question.answerIds.indexOf(answerId);
          if (from !== -1 && to !== -1 && from !== to) {
            pushHistory();
            question.answerIds.splice(to, 0, question.answerIds.splice(from, 1)[0]);
            persist();
            renderCanvas();
          }
        });
      }
    });

    nodeEl.onclick = e => handleQuestionNodeClick(e, question);
  }

  function handleItemNodeClick(e, item) {
    const action = e.target.closest('[data-action]')?.dataset?.action;
    const spawnLabel = e.target.closest('[data-spawn]')?.dataset?.spawn;
    const spawnCustom = e.target.closest('[data-spawn-custom]');

    if (action === 'collapse') {
      e.stopPropagation();
      setExpandedNode(item.id, 'collapsed');
      return;
    }
    if (action === 'delete-item') {
      e.stopPropagation();
      deleteItem(item.id);
      return;
    }
    if (action === 'add-source') {
      e.stopPropagation();
      addSource(item.id);
      return;
    }
    if (action === 'order-children') {
      e.stopPropagation();
      openOrderSheet({ kind: 'item', id: item.id }, e.target);
      return;
    }
    if (spawnLabel) {
      e.stopPropagation();
      spawnQuestion(item.id, spawnLabel);
      return;
    }
    if (spawnCustom) {
      e.stopPropagation();
      addCustomQuestion(item.id);
      return;
    }
    if (e.target.closest('[data-action="delete-source"]')) {
      e.stopPropagation();
      const sourceId = e.target.closest('[data-source-id]')?.dataset?.sourceId;
      if (sourceId) deleteSource(item.id, sourceId);
      return;
    }
    // Click on chip or card background expands
    if (!e.target.closest('[contenteditable="true"], input, button')) {
      state.ui.focusTarget = { kind: 'item', id: item.id };
      setFocusedNode(item.id);
      if (item.nodeMode !== 'expanded') {
        setExpandedNode(item.id, 'expanded');
      }
    }
  }

  function handleQuestionNodeClick(e, question) {
    const action = e.target.closest('[data-action]')?.dataset?.action;
    const childSpawnLabel = e.target.closest('[data-child-spawn]')?.dataset?.childSpawn;
    const childSpawnCustom = e.target.closest('[data-child-spawn-custom]');
    const deleteAnswerId = e.target.closest('[data-delete-answer]')?.dataset?.deleteAnswer;

    if (action === 'delete-question') {
      e.stopPropagation();
      deleteQuestion(question.id);
      return;
    }
    if (action === 'add-answer') {
      e.stopPropagation();
      addAnswerToQuestion(question.id);
      return;
    }
    if (action === 'order-children') {
      e.stopPropagation();
      openOrderSheet({ kind: 'question', id: question.id }, e.target);
      return;
    }
    if (action === 'split-bullets') {
      e.stopPropagation();
      splitAnswerIntoBullets(question.id);
      return;
    }
    if (childSpawnLabel) {
      e.stopPropagation();
      const answerId = e.target.closest('[data-answer-id]')?.dataset?.answerId;
      if (answerId) spawnQuestion(answerId, childSpawnLabel);
      return;
    }
    if (childSpawnCustom) {
      e.stopPropagation();
      const answerId = e.target.closest('[data-answer-id]')?.dataset?.answerId;
      if (answerId) addCustomQuestion(answerId);
      return;
    }
    if (deleteAnswerId) {
      e.stopPropagation();
      deleteItem(deleteAnswerId);
      return;
    }

    if (!e.target.closest('button, input, [contenteditable="true"]')) {
      const answerId = e.target.closest('[data-answer-id]')?.dataset?.answerId;
      state.ui.focusTarget = answerId
        ? { kind: 'item', id: answerId }
        : { kind: 'question', id: question.id };
    }

    // Clicking the card activates this question
    if (!e.target.closest('[contenteditable="true"], input, button')) {
      state.ui.activeQuestionId = question.id;
      setFocusedNode(question.parentItemId);
      persist();
      renderCanvas();
    }
  }

  // ── SVG connection lines ──────────────────────────────────────────────────

  function renderConnections(layout) {
    els.connectionLayer.innerHTML = '';

    // Draw one bezier per question: parent item pos → question node pos
    Object.values(state.entities.questions).forEach(question => {
      const parentPos = layout.get(question.parentItemId);
      const qPos = layout.get(question.id);
      if (!parentPos || !qPos) return;

      const x1 = parentPos.x + parentPos.w;
      const y1 = parentPos.y + parentPos.h / 2;
      const x2 = qPos.x;
      const y2 = qPos.y + qPos.h / 2;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1},${y1} L ${x2},${y2}`);
      path.setAttribute('class', `connection-path ${colorClassForLabel(question.label)}`);
      els.connectionLayer.appendChild(path);
    });
  }

  // ── Pan / zoom ────────────────────────────────────────────────────────────

  function canvasState() {
    return phoneMedia.matches ? state.ui.phoneCanvas : state.ui.canvas;
  }

  function applyTransform() {
    const { panX, panY, scale } = canvasState();
    const t = `translate(${panX}px, ${panY}px) scale(${scale})`;
    els.canvasWorld.style.transform = t;
    els.connectionLayer.style.transform = t;
    els.connectionLayer.style.transformOrigin = '0 0';
  }

  function updateFidelityClass() {
    const scale = canvasState().scale;
    els.canvasWorld.classList.remove('fidelity-full', 'fidelity-medium', 'fidelity-abstract');
    if (scale >= 0.6) els.canvasWorld.classList.add('fidelity-full');
    else if (scale >= 0.3) els.canvasWorld.classList.add('fidelity-medium');
    else els.canvasWorld.classList.add('fidelity-abstract');
    updateZoomReadout();
  }

  function updateZoomReadout() {
    if (els.resetZoomBtn) els.resetZoomBtn.textContent = Math.round(canvasState().scale * 100) + '%';
  }

  const clampScale = s => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));

  // Briefly enable a CSS transition so stepped (button/hotkey) zoom glides;
  // wheel and drag stay instant so they track the input 1:1.
  let zoomAnimTimer = null;
  function animateTransformOnce() {
    els.canvasWorld.classList.add('zoom-animating');
    els.connectionLayer.classList.add('zoom-animating');
    clearTimeout(zoomAnimTimer);
    zoomAnimTimer = setTimeout(() => {
      els.canvasWorld.classList.remove('zoom-animating');
      els.connectionLayer.classList.remove('zoom-animating');
    }, 180);
  }

  function schedulePersistCanvas() {
    clearTimeout(canvasPersistTimer);
    canvasPersistTimer = setTimeout(persist, 300);
  }

  // Zoom while keeping the given viewport point fixed under the cursor.
  function zoomToPoint(px, py, factor) {
    const canvas = canvasState();
    const { panX, panY, scale } = canvas;
    const newScale = clampScale(scale * factor);
    const actual = newScale / scale;
    canvas.panX = px - (px - panX) * actual;
    canvas.panY = py - (py - panY) * actual;
    canvas.scale = newScale;
    applyTransform();
    updateFidelityClass();
  }

  // Stepped zoom (buttons + hotkeys), anchored at the viewport center, eased.
  function zoomStep(factor) {
    animateTransformOnce();
    zoomToPoint(els.boardView.offsetWidth / 2, els.boardView.offsetHeight / 2, factor);
    schedulePersistCanvas();
  }

  function setCanvasTransform(panX, panY, scale) {
    const canvas = canvasState();
    canvas.panX = panX;
    canvas.panY = panY;
    canvas.scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
    applyTransform();
    updateFidelityClass();
    persist();
  }

  function handleWheel(e) {
    e.preventDefault();
    const lineScale = e.deltaMode === 1 ? 16 : 1; // normalize line-mode wheels
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch (the browser sets ctrlKey) or Cmd/Ctrl + wheel: zoom to
      // the cursor. Proportional to delta so a pinch feels smooth.
      const rect = els.boardView.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * lineScale * 0.0015);
      zoomToPoint(e.clientX - rect.left, e.clientY - rect.top, factor);
    } else {
      // Plain scroll / two-finger drag: pan. Shift maps a vertical-only wheel
      // to horizontal panning.
      let dx = e.deltaX * lineScale;
      let dy = e.deltaY * lineScale;
      if (e.shiftKey && dx === 0) { dx = dy; dy = 0; }
      const canvas = canvasState();
      canvas.panX -= dx;
      canvas.panY -= dy;
      applyTransform();
    }
    schedulePersistCanvas();
  }

  function startNodeDrag(e, questionId, nodeEl, pos) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = els.boardView.getBoundingClientRect();
    const { panX, panY, scale } = canvasState();
    const mx = (e.clientX - rect.left - panX) / scale;
    const my = (e.clientY - rect.top  - panY) / scale;
    nodeDragState = {
      questionId, nodeEl,
      startMX: mx, startMY: my,
      startX: pos.x, startY: pos.y,
    };
    nodeEl.style.cursor = 'grabbing';
    const handle = e.currentTarget;
    handle.setPointerCapture?.(e.pointerId);

    const onMove = moveEvent => {
      if (!nodeDragState) return;
      const boardRect = els.boardView.getBoundingClientRect();
      const canvas = canvasState();
      const pointerX = (moveEvent.clientX - boardRect.left - canvas.panX) / canvas.scale;
      const pointerY = (moveEvent.clientY - boardRect.top - canvas.panY) / canvas.scale;
      const newX = nodeDragState.startX + (pointerX - nodeDragState.startMX);
      const newY = nodeDragState.startY + (pointerY - nodeDragState.startMY);
      const question = state.entities.questions[nodeDragState.questionId];
      if (question) {
        question.manualX = newX;
        question.manualY = newY;
      }
      nodeDragState.nodeEl.style.left = `${newX}px`;
      nodeDragState.nodeEl.style.top = `${newY}px`;
      renderConnections(computeLayout());
    };

    const onEnd = endEvent => {
      if (!nodeDragState) return;
      if (handle.hasPointerCapture?.(endEvent.pointerId)) {
        handle.releasePointerCapture(endEvent.pointerId);
      }
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      nodeDragState.nodeEl.style.cursor = '';
      nodeDragState = null;
      persist();
      renderCanvas();
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  }

  function arrangeLayout() {
    Object.values(state.entities.questions).forEach(q => {
      delete q.manualX;
      delete q.manualY;
    });
    persist();
    renderCanvas();
  }

  function initPanEvents() {
    let didPan = false;
    const pointers = new Map();
    let pinchStart = null;

    els.boardView.addEventListener('wheel', handleWheel, { passive: false });

    els.boardView.addEventListener('click', e => {
      if (didPan) {
        didPan = false;
        // Pointer-generated clicks have a non-zero detail. Preserve keyboard
        // activation (detail === 0) if it happens to be the next interaction
        // after a pan.
        if (e.detail !== 0) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    }, true);

    els.boardView.addEventListener('click', e => {
      if (e.target.closest('.node')) return;
      if (state.ui.selectedItemId || state.ui.activeQuestionId) {
        state.ui.selectedItemId = null;
        state.ui.activeQuestionId = null;
        persist();
        renderCanvas();
        updateButtons();
      }
    });

    els.boardView.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const isInteractive = e.target.closest('button, [contenteditable="true"], input, select, textarea, a');
      if (isInteractive) return;
      if (!phoneMedia.matches && e.target.closest('[data-node-id]')) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      els.boardView.setPointerCapture?.(e.pointerId);
      const canvas = canvasState();
      if (pointers.size === 1) {
        panStart = { x: e.clientX - canvas.panX, y: e.clientY - canvas.panY };
        didPan = false;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const rect = els.boardView.getBoundingClientRect();
        const midX = (a.x + b.x) / 2 - rect.left;
        const midY = (a.y + b.y) / 2 - rect.top;
        pinchStart = {
          distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          scale: canvas.scale,
          worldX: (midX - canvas.panX) / canvas.scale,
          worldY: (midY - canvas.panY) / canvas.scale,
        };
      }
      isPanning = true;
      els.boardView.classList.add('is-panning');
    });

    els.boardView.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const canvas = canvasState();
      if (pointers.size >= 2 && pinchStart) {
        const [a, b] = [...pointers.values()];
        const rect = els.boardView.getBoundingClientRect();
        const midX = (a.x + b.x) / 2 - rect.left;
        const midY = (a.y + b.y) / 2 - rect.top;
        const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        canvas.scale = clampScale(pinchStart.scale * distance / pinchStart.distance);
        canvas.panX = midX - pinchStart.worldX * canvas.scale;
        canvas.panY = midY - pinchStart.worldY * canvas.scale;
        didPan = true;
        applyTransform();
        updateFidelityClass();
        return;
      }
      if (pointers.size !== 1) return;
      const newPanX = e.clientX - panStart.x;
      const newPanY = e.clientY - panStart.y;
      if (Math.abs(newPanX - canvas.panX) + Math.abs(newPanY - canvas.panY) > 3) didPan = true;
      canvas.panX = newPanX;
      canvas.panY = newPanY;
      applyTransform();
    });

    const endPointer = e => {
      pointers.delete(e.pointerId);
      if (els.boardView.hasPointerCapture?.(e.pointerId)) {
        els.boardView.releasePointerCapture(e.pointerId);
      }
      if (pointers.size === 1) {
        const remaining = [...pointers.values()][0];
        const canvas = canvasState();
        panStart = { x: remaining.x - canvas.panX, y: remaining.y - canvas.panY };
      } else if (!pointers.size) {
        isPanning = false;
        pinchStart = null;
        els.boardView.classList.remove('is-panning');
        schedulePersistCanvas();
      }
    };
    els.boardView.addEventListener('pointerup', endPointer);
    els.boardView.addEventListener('pointercancel', endPointer);

  }

  function resetZoom() {
    animateTransformOnce();
    setCanvasTransform(phoneMedia.matches ? 24 : 60, phoneMedia.matches ? 24 : 60, 1.0);
  }

  function fitView() {
    const layout = computeLayout();
    if (layout.size === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    layout.forEach(pos => {
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + pos.w);
      maxY = Math.max(maxY, pos.y + pos.h);
    });
    const PAD = 60;
    const vw = els.boardView.offsetWidth;
    const vh = els.boardView.offsetHeight;
    const contentW = maxX - minX + PAD * 2;
    const contentH = maxY - minY + PAD * 2;
    const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(vw / contentW, vh / contentH)));
    const panX = (vw - (maxX + minX) * scale) / 2;
    const panY = (vh - (maxY + minY) * scale) / 2;
    animateTransformOnce();
    setCanvasTransform(panX, panY, scale);
  }

  function zoomToNode(nodeId) {
    const layout = computeLayout();
    const pos = layout.get(nodeId);
    if (!pos) return;
    const vw = els.boardView.offsetWidth;
    const vh = els.boardView.offsetHeight;
    const targetScale = 1.0;
    const panX = vw / 2 - (pos.x + pos.w / 2) * targetScale;
    const panY = vh / 2 - (pos.y + pos.h / 2) * targetScale;
    animateTransformOnce();
    setCanvasTransform(panX, panY, targetScale);
  }

  // ── Node mutation helpers ─────────────────────────────────────────────────

  function spawnQuestion(parentItemId, label, { stayInFocus = false } = {}) {
    const item = state.entities.items[parentItemId];
    if (!item) return;
    pushHistory();
    const q = createQuestionInternal(state, parentItemId, label);
    // Add a first blank answer item
    createItemInternal(state, { kind: 'answer', text: '', parentQuestionId: q.id });
    state.ui.activeQuestionId = q.id;
    state.ui.selectedItemId = parentItemId;
    if (stayInFocus) state.ui.focusTarget = { kind: 'item', id: parentItemId };
    persist();
    render();
    requestAnimationFrame(() => {
      if (stayInFocus) {
        focusWithoutHistory(document.getElementById(`focus-child-${q.id}`));
      } else {
        zoomToNode(q.id);
        const answerEl = document.querySelector(`[data-node-id="${q.id}"] [data-item-text]`);
        focusWithoutHistory(answerEl);
      }
    });
  }

  // Custom questions spawn a new card with a blank, editable title and drop the
  // cursor straight into it — no naming popup — so the discussion can continue
  // inline. An optional label lets callers pre-fill the title if they want.
  function addCustomQuestion(parentItemId, label = '', { stayInFocus = false } = {}) {
    const item = state.entities.items[parentItemId];
    if (!item) return;
    pushHistory();
    const q = createQuestionInternal(state, parentItemId, (label || '').trim());
    createItemInternal(state, { kind: 'answer', text: '', parentQuestionId: q.id });
    state.ui.activeQuestionId = q.id;
    state.ui.selectedItemId = parentItemId;
    if (stayInFocus) state.ui.focusTarget = { kind: 'item', id: parentItemId };
    persist();
    render();
    requestAnimationFrame(() => {
      if (stayInFocus) focusWithoutHistory(document.getElementById(`focus-child-${q.id}`));
      else {
        zoomToNode(q.id);
        focusEditable(`[data-node-id="${q.id}"] [data-question-label="${q.id}"]`);
      }
    });
  }

  function addAnswerToQuestion(questionId, { stayInFocus = false } = {}) {
    const q = state.entities.questions[questionId];
    if (!q) return;
    pushHistory();
    const item = createItemInternal(state, { kind: 'answer', text: '', parentQuestionId: questionId });
    state.ui.activeQuestionId = questionId;
    if (stayInFocus) state.ui.focusTarget = { kind: 'question', id: questionId };
    persist();
    render();
    requestAnimationFrame(() => {
      if (stayInFocus) focusWithoutHistory(document.getElementById(`focus-child-${item.id}`));
      else focusEditable(`[data-node-id="${questionId}"] [data-item-text="${item.id}"]`);
    });
  }

  function splitAnswerIntoBullets(questionId) {
    const q = state.entities.questions[questionId];
    if (!q || q.answerIds.length !== 1) return;
    const source = state.entities.items[q.answerIds[0]];
    if (!source) return;
    const lines = (source.text || '').split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return;
    pushHistory();
    // Remove the original answer (deleteItemRecursive already cleans q.answerIds)
    deleteItemRecursive(source.id);
    // Create one item per line
    lines.forEach(line => {
      createItemInternal(state, { kind: 'answer', text: line, parentQuestionId: questionId });
    });
    persist();
    render();
  }

  function focusEditable(selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    focusWithoutHistory(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function updateItemText(itemId, text) {
    const item = state.entities.items[itemId];
    if (!item) return;
    item.text = text;
    item.updatedAt = Date.now();
    persist();
    renderOutlineText();
    updateButtons();
  }

  function updateQuestionLabel(questionId, label) {
    const q = state.entities.questions[questionId];
    if (!q) return;
    q.label = label;
    q.updatedAt = Date.now();
    persist();
    renderOutlineText();
    renderConnections(computeLayout());
  }

  function deleteQuestion(questionId) {
    const q = state.entities.questions[questionId];
    if (!q) return;
    openConfirm(
      'Delete Question Branch',
      'This will delete the question and all nested answers beneath it.',
      () => {
        pushHistory();
        deleteQuestionRecursive(questionId);
        normalizeState();
        persist();
        render();
      }
    );
  }

  function deleteQuestionRecursive(questionId, cleanParent = true) {
    const q = state.entities.questions[questionId];
    if (!q) return;
    q.answerIds.slice().forEach(answerId => deleteItemRecursive(answerId));
    if (cleanParent) {
      const parentItem = state.entities.items[q.parentItemId];
      if (parentItem) parentItem.questionIds = parentItem.questionIds.filter(id => id !== questionId);
    }
    if (state.ui.activeQuestionId === questionId) state.ui.activeQuestionId = null;
    delete state.entities.questions[questionId];
  }

  function deleteItemRecursive(itemId) {
    const item = state.entities.items[itemId];
    if (!item) return;
    item.questionIds.slice().forEach(questionId => deleteQuestionRecursive(questionId, false));
    if (item.parentQuestionId) {
      const pq = state.entities.questions[item.parentQuestionId];
      if (pq) pq.answerIds = pq.answerIds.filter(id => id !== itemId);
    }
    state.roots = state.roots.filter(id => id !== itemId);
    if (state.ui.selectedItemId === itemId) {
      state.ui.selectedItemId = state.roots[0] || null;
      state.ui.activeQuestionId = null;
    }
    delete state.entities.items[itemId];
  }

  function deleteItem(itemId) {
    const item = state.entities.items[itemId];
    if (!item) return;
    openConfirm(
      'Delete Card',
      'This will delete the card and all nested branches beneath it.',
      () => {
        pushHistory();
        deleteItemRecursive(itemId);
        normalizeState();
        persist();
        render();
      }
    );
  }

  function addSource(itemId) {
    const item = state.entities.items[itemId];
    if (!item) return;
    pushHistory();
    item.sourceList.push({ id: uid('src'), label: '', url: '', note: '' });
    persist();
    render();
    requestAnimationFrame(() => {
      focusWithoutHistory(els.focusCurrent?.querySelector(`[data-focus-source-item="${itemId}"]:last-child input`));
    });
  }

  function updateSource(itemId, sourceId, key, value) {
    const item = state.entities.items[itemId];
    if (!item) return;
    if (!['label', 'url', 'note'].includes(key)) return;
    const source = item.sourceList.find(s => s.id === sourceId);
    if (!source) return;
    source[key] = value;
    item.updatedAt = Date.now();
    schedulePersist();
    renderOutlineText();
  }

  function deleteSource(itemId, sourceId) {
    const item = state.entities.items[itemId];
    if (!item) return;
    pushHistory();
    item.sourceList = item.sourceList.filter(s => s.id !== sourceId);
    persist();
    render();
  }

  // ── Source editor HTML builder ────────────────────────────────────────────

  function buildSourceEditorHtml(item) {
    if (!item.sourceList.length) return '';
    return item.sourceList.map(src => {
      const safeUrl = /^https?:\/\//i.test(src.url || '') ? src.url : null;
      return `
        <div class="source-grid" data-source-id="${src.id}">
          <div class="source-row">
            <input type="text" data-key="label" value="${escapeAttr(src.label || '')}" placeholder="Source label" />
            <input type="url" data-key="url" value="${escapeAttr(src.url || '')}" placeholder="https://…" />
            <input type="text" data-key="note" class="source-note" value="${escapeAttr(src.note || '')}" placeholder="Optional note" />
          </div>
          <div class="sort-row">
            <div class="sort-left">
              ${safeUrl ? `<a href="${escapeAttr(safeUrl)}" target="_blank" rel="noopener noreferrer" class="pill">Open ↗</a>` : ''}
            </div>
            <div class="sort-right">
              <button type="button" class="soft" data-action="delete-source" style="padding:5px 10px;font-size:0.78rem;">Delete</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function wireSourceListeners(nodeEl, item) {
    const mount = nodeEl.querySelector(`[data-source-mount="${item.id}"]`);
    if (!mount) return;
    mount.querySelectorAll('input').forEach(input => {
      input.addEventListener('focus', pushHistoryOnce);
      input.addEventListener('input', e => updateSource(item.id, input.closest('[data-source-id]')?.dataset?.sourceId, e.target.dataset.key, e.target.value));
    });
  }

  // ── Outline text generation ───────────────────────────────────────────────

  function renderOutlineText() {
    const text = generateOutline();
    els.outlineText.textContent = text;
  }

  // "Overview then systematic dive" outline. At each element we first list its
  // immediate children, then walk those children in order and expand any that
  // themselves branch (pre-order depth-first, backtracking to siblings when a
  // branch dead-ends). Every node prints at an indent equal to its depth and
  // carries the same path-number both in its parent's child-list and as its own
  // section header, so the deliberate repetition that makes a multi-threaded
  // tree followable stays aligned column-for-column.
  function generateOutline() {
    const roots = state.roots
      .map(id => state.entities.items[id])
      .filter(Boolean)
      .filter(filterMatchesItem);
    if (!state.roots.length) return 'No topic yet.';
    if (!roots.length) return 'No matches for the current search.';
    const lines = [];
    roots.forEach(root => {
      lines.push(flattenInline(itemLabel(root)));
      pushOutlineSources(lines, root, '');
      expandOutlineItem(lines, root, '');
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function outlineNumber(parentNum, index) {
    return parentNum ? `${parentNum}.${index + 1}` : `${index + 1}`;
  }

  function outlineIndent(num) {
    return '  '.repeat(num.split('.').length);
  }

  function questionOutlineLabel(question) {
    return flattenInline(question.label || 'Question').replace(/\?+$/, '') + '?';
  }

  function pushOutlineSources(lines, item, num) {
    const indent = num ? outlineIndent(num) + '  ' : '  ';
    (item.sourceList || [])
      .filter(src => [src.label, src.url, src.note].some(Boolean))
      .forEach(src => {
        const parts = [src.label, src.url, src.note].filter(Boolean).map(flattenInline);
        lines.push(`${indent}[source] ${parts.join(' | ')}`);
      });
  }

  // An item's immediate children are its questions.
  function expandOutlineItem(lines, item, num) {
    const questions = meaningfulQuestionsForItem(item);
    questions.forEach((q, i) => {
      const cn = outlineNumber(num, i);
      lines.push(`${outlineIndent(cn)}${cn}. ${questionOutlineLabel(q)}`);
    });
    lines.push('');
    questions.forEach((q, i) => {
      const cn = outlineNumber(num, i);
      lines.push(`${outlineIndent(cn)}${cn}. ${questionOutlineLabel(q)}`);
      expandOutlineQuestion(lines, q, cn);
    });
  }

  // A question's immediate children are its answers.
  function expandOutlineQuestion(lines, question, num) {
    const answers = meaningfulAnswersForQuestion(question);
    answers.forEach((answer, i) => {
      const cn = outlineNumber(num, i);
      lines.push(`${outlineIndent(cn)}${cn}. ${flattenInline(itemLabel(answer))}`);
      pushOutlineSources(lines, answer, cn);
    });
    lines.push('');
    answers.forEach((answer, i) => {
      if (!meaningfulQuestionsForItem(answer).length) return;
      const cn = outlineNumber(num, i);
      lines.push(`${outlineIndent(cn)}${cn}. ${flattenInline(itemLabel(answer))}`);
      expandOutlineItem(lines, answer, cn);
    });
  }

  function flattenInline(text) {
    return String(text || '').replace(/\s+/g, ' ').trim() || '[blank]';
  }

  // ── Focus workspace ────────────────────────────────────────────────────────

  function currentFocusTarget() {
    if (targetExists(state, state.ui.focusTarget)) return state.ui.focusTarget;
    const rootId = state.roots.find(id => state.entities.items[id]);
    return rootId ? { kind: 'item', id: rootId } : null;
  }

  function focusTargetKey(target) {
    return `${target.kind}:${target.id}`;
  }

  function focusTargetButton(target, className = '') {
    return `<button type="button" class="${className}" data-focus-kind="${target.kind}" data-focus-id="${target.id}">${escapeHtml(targetLabel(state, target))}</button>`;
  }

  function renderFocus() {
    if (state.settings.mainView !== 'focus') return;
    const target = currentFocusTarget();
    const context = target ? getFocusContext(state, target) : null;
    if (!context) {
      els.focusBreadcrumbs.innerHTML = '';
      els.focusContext.innerHTML = '';
      els.focusCurrent.innerHTML = '<div class="focus-card empty-state">No topic is available.</div>';
      els.focusChildren.innerHTML = '';
      return;
    }

    const breadcrumbTargets = [...context.ancestors, context.current];
    els.focusBreadcrumbs.innerHTML = breadcrumbTargets.map((part, index) => `
      ${index ? '<span class="breadcrumb-separator" aria-hidden="true">›</span>' : ''}
      ${focusTargetButton(part, `breadcrumb-button${focusTargetKey(part) === focusTargetKey(context.current) ? ' current' : ''}`)}
    `).join('');

    const siblings = context.siblings;
    els.focusContext.innerHTML = `
      <div class="focus-context-parent">
        <span class="focus-eyebrow">${context.parent ? 'One level up' : 'Topics'}</span>
        ${context.parent
          ? focusTargetButton(context.parent, 'focus-parent-button')
          : `<span class="focus-parent-label">Top level</span>
             ${siblings.length > 1 ? '<button type="button" class="soft" data-order-kind="roots" data-order-id="">Order topics</button>' : ''}`}
      </div>
      ${siblings.length > 1 ? `
        <div class="focus-sibling-strip" aria-label="Siblings">
          ${siblings.map(sibling => focusTargetButton(
            sibling,
            `sibling-chip${focusTargetKey(sibling) === focusTargetKey(context.current) ? ' active' : ''}`,
          )).join('')}
        </div>
      ` : ''}
    `;

    els.focusCurrent.innerHTML = buildFocusCurrentHtml(context.current, context.children);
    els.focusChildren.innerHTML = buildFocusChildrenHtml(context.current, context.children);
    wireFocusInputs();
    wireFocusActions();
    wirePointerReorder(els.focusChildren.querySelector('.focus-child-list'), context.current);
  }

  function buildFocusCurrentHtml(target, children) {
    const childNoun = target.kind === 'item' ? 'questions' : 'answers';
    if (target.kind === 'item') {
      const item = state.entities.items[target.id];
      return `
        <article class="focus-card focus-editor-card">
          <div class="focus-card-heading">
          <div>
            <div class="focus-eyebrow">${item.kind === 'topic' ? 'Topic' : 'Answer'}</div>
            <h2>${escapeHtml(itemLabel(item))}</h2>
          </div>
          <div class="focus-card-tools">
            <button type="button" class="soft focus-order-button" data-order-kind="item" data-order-id="${item.id}" ${children.length < 2 ? 'disabled' : ''}>Order ${childNoun}</button>
            <button type="button" class="soft danger-soft" data-focus-delete-kind="item" data-focus-delete-id="${item.id}">Delete ${item.kind === 'topic' ? 'topic' : 'answer'}</button>
          </div>
          </div>
          <label class="field-label" for="focus-current-text">Content</label>
          <textarea id="focus-current-text" class="focus-textarea" data-focus-item-text="${item.id}" rows="3" placeholder="${item.kind === 'topic' ? 'What’s the topic?' : 'Write an answer…'}">${escapeHtml(item.text || '')}</textarea>
          <section class="focus-source-section" aria-label="Sources">
            <div class="focus-section-heading">
              <div>
                <h3>Sources</h3>
                <p>Keep references attached to this ${item.kind === 'topic' ? 'topic' : 'answer'}.</p>
              </div>
              <button type="button" class="soft" data-focus-action="add-source" data-item-id="${item.id}">+ Source</button>
            </div>
            <div class="focus-source-list">
              ${(item.sourceList || []).map(source => buildFocusSourceHtml(item, source)).join('') || '<p class="focus-muted">No sources yet.</p>'}
            </div>
          </section>
        </article>
      `;
    }

    const question = state.entities.questions[target.id];
    const singleAnswer = question.answerIds.length === 1 ? state.entities.items[question.answerIds[0]] : null;
    const canSplit = singleAnswer
      && (singleAnswer.text || '').includes('\n')
      && singleAnswer.text.split('\n').filter(line => line.trim()).length > 1;
    return `
      <article class="focus-card focus-editor-card">
        <div class="focus-card-heading">
          <div>
            <div class="focus-eyebrow">Question</div>
            <h2>${escapeHtml((question.label || '').trim() || 'Untitled question')}</h2>
          </div>
          <div class="focus-card-tools">
            <button type="button" class="soft focus-order-button" data-order-kind="question" data-order-id="${question.id}" ${children.length < 2 ? 'disabled' : ''}>Order answers</button>
            ${canSplit ? `<button type="button" class="soft" data-focus-action="split-answers" data-question-id="${question.id}">Split lines into answers</button>` : ''}
            <button type="button" class="soft danger-soft" data-focus-delete-kind="question" data-focus-delete-id="${question.id}">Delete question</button>
          </div>
        </div>
        <label class="field-label" for="focus-current-question">Question</label>
        <input id="focus-current-question" class="focus-input" type="text" data-focus-question-label="${question.id}" value="${escapeAttr(question.label || '')}" placeholder="Question…" />
      </article>
    `;
  }

  function buildFocusSourceHtml(item, source) {
    const safeUrl = /^https?:\/\//i.test(source.url || '') ? source.url : null;
    return `
      <div class="focus-source-card" data-focus-source-id="${source.id}" data-focus-source-item="${item.id}">
        <label>Label<input type="text" data-source-key="label" value="${escapeAttr(source.label || '')}" placeholder="Source label" /></label>
        <label>URL<input type="url" data-source-key="url" value="${escapeAttr(source.url || '')}" placeholder="https://…" /></label>
        <label class="source-note-field">Note<input type="text" data-source-key="note" value="${escapeAttr(source.note || '')}" placeholder="Optional note" /></label>
        <div class="focus-source-actions">
          ${safeUrl ? `<a class="soft-link" href="${escapeAttr(safeUrl)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : '<span></span>'}
          <button type="button" class="soft danger-soft" data-focus-action="delete-source" data-item-id="${item.id}" data-source-id="${source.id}">Delete</button>
        </div>
      </div>
    `;
  }

  function buildFocusChildrenHtml(parent, children) {
    const isItem = parent.kind === 'item';
    const title = isItem ? 'Questions' : 'Answers';
    const emptyText = isItem
      ? 'Add a question to start exploring this item.'
      : 'Add an answer to continue this branch.';
    return `
      <div class="focus-section-heading children-heading">
        <div>
          <span class="focus-eyebrow">One level down</span>
          <h2>${title}</h2>
          <p>${children.length} ${children.length === 1 ? title.slice(0, -1).toLowerCase() : title.toLowerCase()}</p>
        </div>
        <div class="focus-add-actions">
          ${isItem ? DEFAULT_QUESTIONS.map(label => `
            <button type="button" class="spawn-btn ${colorClassForLabel(label)}" data-focus-spawn="${label}" data-parent-id="${parent.id}">${label}</button>
          `).join('') + `<button type="button" class="spawn-btn custom" data-focus-spawn-custom="1" data-parent-id="${parent.id}">+ Custom</button>`
          : `<button type="button" class="primary" data-focus-action="add-answer" data-question-id="${parent.id}">+ Answer</button>`}
        </div>
      </div>
      <div class="focus-child-list" data-order-parent-kind="${parent.kind}" data-order-parent-id="${parent.id}">
        ${children.map((child, index) => buildFocusChildRow(parent, child, index, children.length)).join('')
          || `<div class="focus-empty-children">${emptyText}</div>`}
      </div>
    `;
  }

  function buildFocusChildRow(parent, child, index, total) {
    const isQuestion = child.kind === 'question';
    const entity = isQuestion ? state.entities.questions[child.id] : state.entities.items[child.id];
    const label = isQuestion ? 'Question' : 'Answer';
    return `
      <article class="focus-child-row" data-order-child-id="${child.id}">
        <button type="button" class="order-drag-handle" aria-label="Reorder ${label.toLowerCase()}. Drag or use arrow keys." title="Drag or use arrow keys to reorder">⋮⋮</button>
        <span class="order-index" aria-label="Position ${index + 1}">${index + 1}</span>
        <div class="focus-child-editor">
          <label class="field-label" for="focus-child-${child.id}">${label}</label>
          ${isQuestion
            ? `<input id="focus-child-${child.id}" class="focus-input" type="text" data-focus-question-label="${child.id}" value="${escapeAttr(entity.label || '')}" placeholder="Question…" />`
            : `<textarea id="focus-child-${child.id}" class="focus-textarea compact" data-focus-item-text="${child.id}" rows="2" placeholder="Write an answer…">${escapeHtml(entity.text || '')}</textarea>`}
        </div>
        <div class="focus-child-actions">
          <button type="button" class="soft move-button" data-move-child="${child.id}" data-parent-kind="${parent.kind}" data-parent-id="${parent.id}" data-direction="-1" aria-label="Move ${label.toLowerCase()} up" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="soft move-button" data-move-child="${child.id}" data-parent-kind="${parent.kind}" data-parent-id="${parent.id}" data-direction="1" aria-label="Move ${label.toLowerCase()} down" ${index === total - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="primary focus-open-child" data-focus-kind="${child.kind}" data-focus-id="${child.id}">Focus <span aria-hidden="true">→</span></button>
          <button type="button" class="soft danger-soft" data-focus-delete-kind="${child.kind}" data-focus-delete-id="${child.id}" aria-label="Delete ${label.toLowerCase()}">Delete</button>
        </div>
      </article>
    `;
  }

  function wireFocusInputs() {
    els.focusView.querySelectorAll('[data-focus-item-text]').forEach(field => {
      autoGrowField(field);
      field.addEventListener('focus', pushHistoryOnce);
      field.addEventListener('input', () => {
        const item = state.entities.items[field.dataset.focusItemText];
        if (!item) return;
        item.text = field.value;
        item.updatedAt = Date.now();
        autoGrowField(field);
        schedulePersist();
        renderOutlineText();
      });
    });
    els.focusView.querySelectorAll('[data-focus-question-label]').forEach(field => {
      field.addEventListener('focus', pushHistoryOnce);
      field.addEventListener('input', () => {
        const question = state.entities.questions[field.dataset.focusQuestionLabel];
        if (!question) return;
        question.label = field.value;
        question.updatedAt = Date.now();
        schedulePersist();
        renderOutlineText();
      });
    });
    els.focusView.querySelectorAll('[data-focus-source-id] input').forEach(field => {
      field.addEventListener('focus', pushHistoryOnce);
      field.addEventListener('input', () => {
        const card = field.closest('[data-focus-source-id]');
        updateSource(card.dataset.focusSourceItem, card.dataset.focusSourceId, field.dataset.sourceKey, field.value);
      });
    });
  }

  function autoGrowField(field) {
    if (field.tagName !== 'TEXTAREA') return;
    field.style.height = 'auto';
    field.style.height = `${Math.max(field.scrollHeight, 72)}px`;
  }

  function wireFocusActions() {
    els.focusView.querySelectorAll('[data-focus-kind][data-focus-id]').forEach(button => {
      button.addEventListener('click', () => setFocusTarget({
        kind: button.dataset.focusKind,
        id: button.dataset.focusId,
      }));
    });
    els.focusView.querySelectorAll('[data-focus-spawn]').forEach(button => {
      button.addEventListener('click', () => spawnQuestion(button.dataset.parentId, button.dataset.focusSpawn, { stayInFocus: true }));
    });
    els.focusView.querySelectorAll('[data-focus-spawn-custom]').forEach(button => {
      button.addEventListener('click', () => addCustomQuestion(button.dataset.parentId, '', { stayInFocus: true }));
    });
    els.focusView.querySelectorAll('[data-focus-action="add-answer"]').forEach(button => {
      button.addEventListener('click', () => addAnswerToQuestion(button.dataset.questionId, { stayInFocus: true }));
    });
    els.focusView.querySelectorAll('[data-focus-action="split-answers"]').forEach(button => {
      button.addEventListener('click', () => splitAnswerIntoBullets(button.dataset.questionId));
    });
    els.focusView.querySelectorAll('[data-focus-action="add-source"]').forEach(button => {
      button.addEventListener('click', () => addSource(button.dataset.itemId));
    });
    els.focusView.querySelectorAll('[data-focus-action="delete-source"]').forEach(button => {
      button.addEventListener('click', () => deleteSource(button.dataset.itemId, button.dataset.sourceId));
    });
    els.focusView.querySelectorAll('[data-focus-delete-kind]').forEach(button => {
      button.addEventListener('click', () => {
        if (button.dataset.focusDeleteKind === 'question') deleteQuestion(button.dataset.focusDeleteId);
        else deleteItem(button.dataset.focusDeleteId);
      });
    });
    els.focusView.querySelectorAll('[data-order-kind]').forEach(button => {
      button.addEventListener('click', () => openOrderSheet({
        kind: button.dataset.orderKind,
        id: button.dataset.orderId,
      }, button));
    });
    els.focusView.querySelectorAll('[data-move-child]').forEach(button => {
      button.addEventListener('click', () => {
        const parent = { kind: button.dataset.parentKind, id: button.dataset.parentId };
        moveChild(parent, button.dataset.moveChild, Number(button.dataset.direction));
      });
    });
  }

  function moveChild(parent, childId, directionOrIndex, { absolute = false } = {}) {
    const children = parent.kind === 'roots'
      ? state.roots
      : parent.kind === 'item'
        ? state.entities.items[parent.id]?.questionIds
        : state.entities.questions[parent.id]?.answerIds;
    if (!children) return false;
    const from = children.indexOf(childId);
    const targetIndex = absolute ? directionOrIndex : from + directionOrIndex;
    if (from < 0 || targetIndex < 0 || targetIndex >= children.length || from === targetIndex) return false;
    const activeElement = document.activeElement;
    const restoreHandle = activeElement?.classList.contains('order-drag-handle');
    const restoreDirection = activeElement?.dataset?.direction;
    pushHistory();
    if (!moveChildInState(state, parent, childId, targetIndex)) return false;
    persist();
    render();
    requestAnimationFrame(() => {
      const scope = els.orderBackdrop.classList.contains('open') ? els.orderList : els.focusChildren;
      const row = scope.querySelector(`[data-order-child-id="${childId}"]`);
      const preferred = restoreHandle
        ? row?.querySelector('.order-drag-handle')
        : restoreDirection
          ? row?.querySelector(`[data-direction="${restoreDirection}"]:not([disabled])`)
          : null;
      (preferred || row?.querySelector('.order-drag-handle'))?.focus();
    });
    flash('Order updated.');
    return true;
  }

  function wirePointerReorder(container, parent) {
    if (!container) return;
    container.querySelectorAll('.order-drag-handle').forEach(handle => {
      handle.addEventListener('keydown', event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        const row = handle.closest('[data-order-child-id]');
        if (!row) return;
        event.preventDefault();
        moveChild(parent, row.dataset.orderChildId, event.key === 'ArrowUp' ? -1 : 1);
      });
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const row = handle.closest('[data-order-child-id]');
        if (!row) return;
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        row.classList.add('is-reordering');
        const onMove = moveEvent => {
          const candidate = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('[data-order-child-id]');
          if (!candidate || candidate === row || candidate.parentElement !== container) return;
          const rect = candidate.getBoundingClientRect();
          container.insertBefore(row, moveEvent.clientY < rect.top + rect.height / 2 ? candidate : candidate.nextSibling);
        };
        const onEnd = endEvent => {
          row.classList.remove('is-reordering');
          if (handle.hasPointerCapture?.(endEvent.pointerId)) {
            handle.releasePointerCapture(endEvent.pointerId);
          }
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onEnd);
          handle.removeEventListener('pointercancel', onEnd);
          const toIndex = [...container.querySelectorAll('[data-order-child-id]')].indexOf(row);
          moveChild(parent, row.dataset.orderChildId, toIndex, { absolute: true });
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onEnd);
        handle.addEventListener('pointercancel', onEnd);
      });
    });
  }

  function openOrderSheet(parent, trigger) {
    const children = getChildTargets(state, parent);
    if (children.length < 2) return;
    orderSheetParent = { kind: parent.kind, id: parent.id };
    lastDialogTrigger = trigger || document.activeElement;
    renderOrderSheet();
    els.orderBackdrop.classList.add('open');
    els.orderBackdrop.setAttribute('aria-hidden', 'false');
    setBackgroundInert(true);
    requestAnimationFrame(() => els.closeOrderSheetBtn.focus());
  }

  function renderOrderSheet() {
    if (!orderSheetParent) return;
    const children = getChildTargets(state, orderSheetParent);
    const noun = orderSheetParent.kind === 'roots'
      ? 'topics'
      : orderSheetParent.kind === 'item'
        ? 'questions'
        : 'answers';
    els.orderSheetTitle.textContent = `Order ${noun}`;
    const parentLabel = orderSheetParent.kind === 'roots' ? 'top-level topics' : targetLabel(state, orderSheetParent);
    els.orderSheetSubtitle.textContent = `Semantic order for ${parentLabel}. Spatial positions are preserved.`;
    els.orderList.innerHTML = children.map((child, index) => `
      <div class="order-sheet-row" data-order-child-id="${child.id}">
        <button type="button" class="order-drag-handle" aria-label="Reorder child. Drag or use arrow keys.">⋮⋮</button>
        <span class="order-index">${index + 1}</span>
        <span class="order-row-label">${escapeHtml(targetLabel(state, child))}</span>
        <button type="button" class="soft move-button" data-order-move="${child.id}" data-direction="-1" aria-label="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="soft move-button" data-order-move="${child.id}" data-direction="1" aria-label="Move down" ${index === children.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
    `).join('');
    els.orderList.querySelectorAll('[data-order-move]').forEach(button => {
      button.addEventListener('click', () => moveChild(orderSheetParent, button.dataset.orderMove, Number(button.dataset.direction)));
    });
    wirePointerReorder(els.orderList, orderSheetParent);
  }

  function closeOrderSheet() {
    els.orderBackdrop.classList.remove('open');
    els.orderBackdrop.setAttribute('aria-hidden', 'true');
    setBackgroundInert(false);
    orderSheetParent = null;
    if (lastDialogTrigger?.isConnected) lastDialogTrigger.focus();
    else els.focusCurrent?.querySelector('[data-order-kind]')?.focus();
    lastDialogTrigger = null;
  }

  function renderSearchResults() {
    const query = (state.ui.search || '').trim();
    els.searchResults.innerHTML = '';
    els.searchResults.classList.toggle('open', Boolean(query));
    if (!query) return;
    const { results } = findTreeMatches(state, query);
    if (!results.length) {
      els.searchResults.innerHTML = '<div class="search-result-empty">No matching topics, questions, answers, or sources.</div>';
      return;
    }
    results.slice(0, 30).forEach(result => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'search-result-button';
      button.innerHTML = `
        <strong>${escapeHtml(result.label)}</strong>
        <span>${escapeHtml(result.path.join(' › '))}</span>
      `;
      button.addEventListener('click', () => {
        state.ui.search = '';
        els.searchInput.value = '';
        els.searchResults.classList.remove('open');
        setFocusTarget(result.target, { switchView: true });
      });
      els.searchResults.appendChild(button);
    });
  }

  function setBackgroundInert(value) {
    els.workspace.inert = value;
    const topbar = document.querySelector('.topbar');
    if (topbar) topbar.inert = value;
  }

  // ── View / theme state ────────────────────────────────────────────────────

  function setTheme(theme) {
    if (!THEMES.includes(theme)) theme = 'modern';
    state.settings.theme = theme;
    applyBodyClasses();
    persist();
  }

  function applyBodyClasses() {
    document.body.className = `theme-${state.settings.theme || 'modern'}`;
    document.body.classList.toggle('phone-board-preview', phoneMedia.matches && state.settings.mainView === 'board');
  }

  function setMainView(view) {
    state.settings.mainView = view === 'focus' ? 'focus' : 'board';
    applyBodyClasses();
    renderViewMode();
    if (state.settings.mainView === 'focus') renderFocus();
    else renderCanvas();
    persist();
  }

  function toggleSidebar(forceValue) {
    const nextValue = typeof forceValue === 'boolean' ? forceValue : !state.settings.sidebarOpen;
    if (nextValue && phoneMedia.matches) lastSidebarTrigger = document.activeElement;
    state.settings.sidebarOpen = nextValue;
    renderSidebarState();
    persist();
    if (nextValue && phoneMedia.matches) requestAnimationFrame(() => els.collapseSidebarInnerBtn.focus());
    if (!nextValue && phoneMedia.matches) {
      const returnTarget = lastSidebarTrigger;
      lastSidebarTrigger = null;
      returnTarget?.focus?.();
    }
  }

  function renderSidebarState() {
    const sidebar = els.workspace.querySelector('.sidebar');
    els.workspace.classList.toggle('sidebar-collapsed', !state.settings.sidebarOpen);
    els.toggleSidebarBtn.setAttribute('aria-expanded', state.settings.sidebarOpen ? 'true' : 'false');
    els.sidebarBackdrop.classList.toggle('visible', state.settings.sidebarOpen);
    sidebar?.setAttribute('aria-hidden', state.settings.sidebarOpen ? 'false' : 'true');
    if (sidebar) sidebar.inert = !state.settings.sidebarOpen;
  }

  function renderViewMode() {
    const board = state.settings.mainView !== 'focus';
    els.boardView.classList.toggle('hidden', !board);
    els.focusView.classList.toggle('hidden', board);
    els.boardViewBtn.classList.toggle('primary', board);
    els.focusViewBtn.classList.toggle('primary', !board);
    els.boardViewBtn.classList.toggle('soft', !board);
    els.focusViewBtn.classList.toggle('soft', board);
    els.boardViewBtn.setAttribute('aria-pressed', board ? 'true' : 'false');
    els.focusViewBtn.setAttribute('aria-pressed', board ? 'false' : 'true');
  }

  // ── Main render ───────────────────────────────────────────────────────────

  function render() {
    normalizeState();
    applyBodyClasses();
    els.searchInput.value = state.ui.search || '';
    renderSidebarState();
    renderViewMode();
    renderCanvas();
    renderFocus();
    renderOutlineText();
    renderSearchResults();
    updateButtons();
    if (els.orderBackdrop.classList.contains('open') && orderSheetParent) renderOrderSheet();
  }

  function updateButtons() {
    els.undoBtn.disabled = !state.history.past.length;
    els.redoBtn.disabled = !state.history.future.length;
    els.selectionPill.textContent = getSelectedItem() ? itemLabel(getSelectedItem()) : 'No selection';
    const showFocusCta = phoneMedia.matches
      && state.settings.mainView === 'board'
      && Boolean(state.ui.activeQuestionId || state.ui.selectedItemId);
    els.openSelectedInFocusBtn.classList.toggle('hidden', !showFocusCta);
  }

  // ── Editable helpers ──────────────────────────────────────────────────────

  let pushedThisFocus = false;

  function focusWithoutHistory(element, options) {
    if (!element) return;
    suppressNextHistoryFocus = true;
    element.focus(options);
    queueMicrotask(() => { suppressNextHistoryFocus = false; });
  }

  function pushHistoryOnce() {
    if (suppressNextHistoryFocus) {
      suppressNextHistoryFocus = false;
      return;
    }
    if (pushedThisFocus) return;
    pushedThisFocus = true;
    pushHistory();
    updateButtons();
    setTimeout(() => { pushedThisFocus = false; }, 0);
  }

  function attachEditable(element, onCommit, onBeforeEdit) {
    element.addEventListener('focus', () => {
      onBeforeEdit?.();
      if (element.dataset.empty === 'true') element.textContent = '';
    });
    element.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') element.blur();
    });
    element.addEventListener('blur', () => onCommit(getEditableText(element)));
    element.addEventListener('input', () => toggleEditablePlaceholder(element));
  }

  function setEditableContent(el, value, placeholder) {
    el.dataset.placeholder = placeholder;
    const hasValue = Boolean((value || '').trim());
    el.textContent = hasValue ? value : placeholder;
    toggleEditablePlaceholder(el, !hasValue);
  }

  function toggleEditablePlaceholder(el, forceEmpty) {
    const text = getEditableText(el);
    const isEmpty = typeof forceEmpty === 'boolean' ? forceEmpty : !text;
    el.dataset.empty = isEmpty ? 'true' : 'false';
    if (isEmpty && document.activeElement !== el) {
      el.textContent = el.dataset.placeholder || '';
    }
  }

  function getEditableText(el) {
    const raw = (el.textContent || '').trim();
    return raw === (el.dataset.placeholder || '') ? '' : raw;
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function download(filename, content, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function copyToClipboard(text, successMessage = 'Copied to clipboard.') {
    try {
      await navigator.clipboard.writeText(text);
      flash(successMessage);
    } catch (err) {
      console.warn('Clipboard copy failed', err);
      flash('Clipboard access failed. Try Export instead.');
    }
  }

  function flash(message) {
    clearTimeout(toastTimer);
    const pill = els.selectionPill;
    const original = pill.textContent;
    pill.textContent = message;
    els.appToast.textContent = message;
    els.appToast.classList.add('visible');
    toastTimer = setTimeout(() => {
      pill.textContent = getSelectedItem() ? itemLabel(getSelectedItem()) : original;
      els.appToast.classList.remove('visible');
    }, 1800);
  }

  // ── Modal ─────────────────────────────────────────────────────────────────

  function openModal(config) {
    lastDialogTrigger = els.actionsDropdown.contains(document.activeElement)
      ? els.actionsBtn
      : document.activeElement;
    els.modalTitle.textContent = config.title || 'Modal';
    els.modalSubtitle.textContent = config.subtitle || '';
    els.modalTextarea.value = config.initialValue || '';
    els.modalTextarea.style.display = config.hideTextarea ? 'none' : '';
    els.modalActions.innerHTML = '';
    (config.actions || []).forEach(action => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = action.primary ? 'primary' : 'soft';
      btn.textContent = action.label;
      btn.addEventListener('click', () => action.onClick(els.modalTextarea.value));
      els.modalActions.appendChild(btn);
    });
    els.modalBackdrop.classList.add('open');
    els.modalBackdrop.setAttribute('aria-hidden', 'false');
    setBackgroundInert(true);
    setTimeout(() => {
      if (!config.hideTextarea) els.modalTextarea.focus();
      else els.modalActions.querySelector('button')?.focus();
    }, 10);
  }

  function closeModal() {
    els.modalBackdrop.classList.remove('open');
    els.modalBackdrop.setAttribute('aria-hidden', 'true');
    setBackgroundInert(false);
    lastDialogTrigger?.focus?.();
    lastDialogTrigger = null;
  }

  function openConfirm(title, subtitle, onConfirm) {
    openModal({
      title,
      subtitle,
      hideTextarea: true,
      actions: [
        { label: 'Confirm', primary: true, onClick: () => { closeModal(); onConfirm(); } },
        { label: 'Cancel', onClick: closeModal },
      ],
    });
  }

  // ── Import / export ───────────────────────────────────────────────────────

  function exportJson() {
    const payload = deepClone(state);
    download('socrates-app.json', JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  }

  // Walk the item/question graph from the roots and fail if any node is
  // reached twice. A well-formed board is a tree, so a repeated node means a
  // cycle or shared reference — importing it would send the recursive layout
  // and meaningfulness walkers into unbounded recursion and crash the render.
  function assertTree(candidate) {
    const items = candidate.entities?.items || {};
    const questions = candidate.entities?.questions || {};
    const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
    Object.entries(items).forEach(([id, item]) => {
      if (!safeId(id) || item?.id !== id) throw new Error(`Invalid item identifier: ${id}`);
      (item.sourceList || []).forEach(source => {
        if (!safeId(source?.id)) throw new Error(`Invalid source identifier on item: ${id}`);
      });
    });
    Object.entries(questions).forEach(([id, question]) => {
      if (!safeId(id) || question?.id !== id) throw new Error(`Invalid question identifier: ${id}`);
    });
    (candidate.roots || []).forEach(id => {
      if (!safeId(id)) throw new Error(`Invalid root identifier: ${id}`);
    });
    const seenItems = new Set();
    const seenQuestions = new Set();
    const walkItem = id => {
      const item = items[id];
      if (!item) return;
      if (seenItems.has(id)) throw new Error('Cyclic or shared item reference: ' + id);
      seenItems.add(id);
      (item.questionIds || []).forEach(walkQuestion);
    };
    const walkQuestion = id => {
      const q = questions[id];
      if (!q) return;
      if (seenQuestions.has(id)) throw new Error('Cyclic or shared question reference: ' + id);
      seenQuestions.add(id);
      (q.answerIds || []).forEach(walkItem);
    };
    (candidate.roots || []).forEach(walkItem);
  }

  function importJson(raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.roots || !parsed.entities) throw new Error('Invalid JSON structure');
      assertTree(parsed);
      pushHistory();
      const savedHistory = state.history;
      state = parsed;
      state.history = savedHistory;
      if (!state.history.past) state.history.past = [];
      if (!state.history.future) state.history.future = [];
      normalizeState();
      persist();
      render();
      closeModal();
      flash('JSON imported.');
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  }

  function clearBoard() {
    openConfirm(
      'Reset Board',
      'Reset to a fresh canvas? This will clear all current content.',
      () => {
        state = createInitialState();
        persist();
        render();
      }
    );
  }

  // ── Outline text import ───────────────────────────────────────────────────

  // Inverse of generateOutline(). Each line's path-number (e.g. "2.1.1.") fully
  // encodes its position: depth parity says whether it's a question (odd) or an
  // answer (even), and the number minus its last segment is its parent. Repeated
  // lines (a node shown in its parent's list and again as a section header) are
  // deduped by number. Throws if a line doesn't fit the format.
  function buildStateFromOutline(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const numberRe = /^(\d+(?:\.\d+)*)\.\s+(.*)$/;
    const sourceRe = /^\[source\]\s*(.*)$/i;

    let title = null;
    let sawTitle = false;
    let lastNum = null; // null => title context
    const titleSources = [];
    const nodes = new Map(); // num -> { label, kind, sources: [] }

    lines.forEach(raw => {
      const line = raw.trim();
      if (!line) return;

      const sm = line.match(sourceRe);
      if (sm) {
        if (!sawTitle) throw new Error('Found a [source] before any topic title.');
        if (lastNum === null) titleSources.push(sm[1].trim());
        else {
          const node = nodes.get(lastNum);
          if (node && !node.sources.includes(sm[1].trim())) node.sources.push(sm[1].trim());
        }
        return;
      }

      const nm = line.match(numberRe);
      if (nm) {
        if (!sawTitle) throw new Error('Found a numbered line before the topic title.');
        const num = nm[1];
        lastNum = num;
        if (!nodes.has(num)) {
          nodes.set(num, {
            label: nm[2].trim(),
            kind: num.split('.').length % 2 === 1 ? 'question' : 'answer',
            sources: [],
          });
        }
        return;
      }

      if (!sawTitle) { title = line; sawTitle = true; lastNum = null; return; }
      throw new Error(`Line doesn't match the outline format: "${line}"`);
    });

    if (!sawTitle) throw new Error('No topic title found.');

    const s = createInitialState();
    const topicId = s.roots[0];
    const topic = s.entities.items[topicId];
    topic.text = title;
    topic.nodeMode = 'expanded';
    topic.sourceList = titleSources.map(parseSourceString);

    const itemIdByNum = new Map([['', topicId]]);
    const questionIdByNum = new Map();

    const depthOf = n => n.split('.').length;
    const cmpNum = (a, b) => {
      const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
      for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
        if (pa[i] !== pb[i]) return pa[i] - pb[i];
      }
      return pa.length - pb.length;
    };
    // Shallowest first so every parent exists before its children; numeric order
    // within a depth preserves sibling ordering.
    const orderedNums = Array.from(nodes.keys()).sort((a, b) => depthOf(a) - depthOf(b) || cmpNum(a, b));

    orderedNums.forEach(num => {
      const node = nodes.get(num);
      const parentNum = num.split('.').slice(0, -1).join('.');
      if (node.kind === 'question') {
        const parentItemId = itemIdByNum.get(parentNum);
        if (!parentItemId) throw new Error(`Question "${num}" has no parent answer "${parentNum}".`);
        const label = node.label.replace(/\?+$/, '').trim();
        const q = createQuestionInternal(s, parentItemId, label);
        questionIdByNum.set(num, q.id);
      } else {
        const parentQId = questionIdByNum.get(parentNum);
        if (!parentQId) throw new Error(`Answer "${num}" has no parent question "${parentNum}".`);
        const item = createItemInternal(s, { kind: 'answer', text: node.label, parentQuestionId: parentQId });
        item.sourceList = node.sources.map(parseSourceString);
        itemIdByNum.set(num, item.id);
      }
    });

    s.ui.selectedItemId = topicId;
    return s;
  }

  function parseSourceString(str) {
    const parts = String(str || '').split('|').map(p => p.trim()).filter(Boolean);
    const src = { id: uid('src'), label: '', url: '', note: '' };
    const rest = [];
    parts.forEach(p => {
      if (/^https?:\/\//i.test(p) && !src.url) src.url = p;
      else rest.push(p);
    });
    if (rest.length) src.label = rest.shift();
    if (rest.length) src.note = rest.join(' | ');
    return src;
  }

  function applyImportedState(next) {
    pushHistory();
    const savedHistory = state.history;
    state = next;
    state.history = savedHistory;
    if (!state.history.past) state.history.past = [];
    if (!state.history.future) state.history.future = [];
    normalizeState();
    persist();
    render();
  }

  // Modal path: explicit errors are worth an alert.
  function importOutlineText(raw) {
    try {
      applyImportedState(buildStateFromOutline(raw));
      closeModal();
      flash('Outline imported.');
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  }

  // Paste-into-the-outline path: non-blocking feedback so a stray paste is quiet.
  function importOutlineTextFromPaste(raw) {
    try {
      applyImportedState(buildStateFromOutline(raw));
      flash('Outline imported from paste.');
    } catch (err) {
      flash("That paste didn't match the outline format.");
    }
  }

  // ── Examples ──────────────────────────────────────────────────────────────

  async function loadExamplesManifest() {
    if (examplesManifest) return examplesManifest;
    try {
      const res = await fetch('examples/manifest.json');
      if (!res.ok) throw new Error('manifest not found');
      examplesManifest = await res.json();
    } catch {
      examplesManifest = [];
    }
    return examplesManifest;
  }

  function closeActionsDropdown() {
    els.actionsDropdown.classList.remove('open');
    els.actionsBtn.setAttribute('aria-expanded', 'false');
  }

  function addActionItem(dropdown, label, onClick, isDanger) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'examples-dropdown-item' + (isDanger ? ' action-danger' : '');
    btn.setAttribute('role', 'menuitem');
    btn.textContent = label;
    btn.addEventListener('click', () => { closeActionsDropdown(); onClick(); });
    dropdown.appendChild(btn);
  }

  function addActionSep(dropdown) {
    const hr = document.createElement('hr');
    hr.className = 'action-sep';
    dropdown.appendChild(hr);
  }

  async function toggleActionsDropdown() {
    const dropdown = els.actionsDropdown;
    if (dropdown.classList.contains('open')) {
      closeActionsDropdown();
      return;
    }
    dropdown.innerHTML = '';
    addActionItem(dropdown, 'Arrange Layout', arrangeLayout);
    addActionItem(dropdown, 'Reset Zoom', resetZoom);
    addActionSep(dropdown);
    addActionItem(dropdown, 'Copy Outline', () => copyToClipboard(generateOutline(), 'Outline copied.'));
    addActionItem(dropdown, 'Download .txt', () => download('socrates-app-outline.txt', generateOutline()));
    addActionSep(dropdown);
    addActionItem(dropdown, 'Export JSON', exportJson);
    addActionItem(dropdown, 'Import JSON', () => openModal({
      title: 'Import Socrates App JSON',
      subtitle: 'Paste a previously exported JSON payload to resume a session.',
      actions: [
        { label: 'Import', primary: true, onClick: importJson },
        { label: 'Cancel', onClick: closeModal },
      ],
    }));
    addActionItem(dropdown, 'Import Outline Text', () => openModal({
      title: 'Import Outline Text',
      subtitle: 'Paste outline text (the same format as Copy / Download .txt) to rebuild the tree.',
      actions: [
        { label: 'Import', primary: true, onClick: importOutlineText },
        { label: 'Cancel', onClick: closeModal },
      ],
    }));
    addActionSep(dropdown);
    // Examples sub-section: loaded inline
    const exLabel = document.createElement('div');
    exLabel.className = 'examples-dropdown-message';
    exLabel.style.cssText = 'padding:6px 16px 2px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;';
    exLabel.textContent = 'Load Example';
    dropdown.appendChild(exLabel);
    const examples = await loadExamplesManifest();
    if (!examples.length) {
      const msg = document.createElement('div');
      msg.className = 'examples-dropdown-message';
      msg.textContent = 'No examples available.';
      dropdown.appendChild(msg);
    } else {
      examples.forEach(ex => addActionItem(dropdown, ex.name, () => loadExample(ex.file, ex.name)));
    }
    addActionSep(dropdown);
    addActionItem(dropdown, 'Reset Board', clearBoard, true);
    addActionSep(dropdown);
    // Theme section at bottom
    const themeLabel = document.createElement('div');
    themeLabel.className = 'examples-dropdown-message';
    themeLabel.style.cssText = 'padding:6px 16px 2px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;';
    themeLabel.textContent = 'Theme';
    dropdown.appendChild(themeLabel);
    const current = state.settings.theme || 'modern';
    [['modern', 'Modern'], ['sticky', 'Sticky Notes'], ['playful', 'Playful'], ['minimal', 'Minimal']].forEach(([val, label]) => {
      addActionItem(dropdown, (val === current ? '\u2713 ' : '  ') + label, () => setTheme(val));
    });
    dropdown.classList.add('open');
    els.actionsBtn.setAttribute('aria-expanded', 'true');
  }

    async function loadExample(file, name) {
    const doLoad = async () => {
      try {
        const res = await fetch(`examples/${file}`);
        if (!res.ok) throw new Error(`Could not fetch examples/${file}`);
        const raw = await res.text();
        importJson(raw);
      } catch (err) {
        alert('Failed to load example: ' + err.message);
      }
    };
    if (state.roots.some(id => isItemMeaningful(state.entities.items[id]))) {
      openConfirm(
        `Load "${escapeHtml(name)}"`,
        'Your current board will be replaced.',
        doLoad
      );
    } else {
      doLoad();
    }
  }

  // ── Event wiring ──────────────────────────────────────────────────────────

  function setupEvents() {
    els.toggleSidebarBtn.addEventListener('click', () => toggleSidebar());
    els.collapseSidebarInnerBtn.addEventListener('click', () => toggleSidebar(false));
    els.sidebarBackdrop.addEventListener('click', () => toggleSidebar(false));
    els.boardViewBtn.addEventListener('click', () => setMainView('board'));
    els.focusViewBtn.addEventListener('click', () => setMainView('focus'));
    els.undoBtn.addEventListener('click', undo);
    els.redoBtn.addEventListener('click', redo);
    els.resetZoomBtn?.addEventListener('click', resetZoom);
    els.zoomInBtn?.addEventListener('click', () => zoomStep(1.25));
    els.zoomOutBtn?.addEventListener('click', () => zoomStep(0.8));
    els.zoomFitBtn?.addEventListener('click', fitView);
    els.actionsBtn.addEventListener('click', e => { e.stopPropagation(); toggleActionsDropdown(); });
    els.closeOrderSheetBtn.addEventListener('click', closeOrderSheet);
    els.orderBackdrop.addEventListener('click', e => {
      if (e.target === els.orderBackdrop) closeOrderSheet();
    });
    els.openSelectedInFocusBtn.addEventListener('click', () => {
      const target = targetExists(state, state.ui.focusTarget)
        ? state.ui.focusTarget
        : state.ui.activeQuestionId
          ? { kind: 'question', id: state.ui.activeQuestionId }
          : { kind: 'item', id: state.ui.selectedItemId };
      setFocusTarget(target, { switchView: true });
    });
    document.addEventListener('click', e => {
      if (!els.actionsDropdown.classList.contains('open')) return;
      if (!els.actionsBtn.contains(e.target) && !els.actionsDropdown.contains(e.target)) {
        closeActionsDropdown();
      }
    });
    els.searchInput.addEventListener('input', e => {
      state.ui.search = e.target.value;
      schedulePersist();
      renderOutlineText();
      renderSearchResults();
      renderCanvas();
    });
    els.copyOutlineBtn.addEventListener('click', () => copyToClipboard(generateOutline(), 'Outline copied.'));
    els.downloadTextBtn.addEventListener('click', () => download('socrates-app-outline.txt', generateOutline()));
    els.outlineText.addEventListener('paste', e => {
      const pasted = (e.clipboardData || window.clipboardData)?.getData('text') || '';
      if (!pasted.trim()) return;
      e.preventDefault();
      importOutlineTextFromPaste(pasted);
    });
    els.closeModalBtn.addEventListener('click', closeModal);
    els.modalBackdrop.addEventListener('click', e => {
      if (e.target === els.modalBackdrop) closeModal();
    });
    const handlePhoneMediaChange = () => {
      applyBodyClasses();
      render();
    };
    if (phoneMedia.addEventListener) phoneMedia.addEventListener('change', handlePhoneMediaChange);
    else phoneMedia.addListener?.(handlePhoneMediaChange);

    document.addEventListener('keydown', e => {
      const focusLayer = els.modalBackdrop.classList.contains('open')
        ? els.modalBackdrop.querySelector('.modal')
        : els.orderBackdrop.classList.contains('open')
          ? els.orderSheet
          : phoneMedia.matches && state.settings.sidebarOpen
            ? els.workspace.querySelector('.sidebar')
            : null;
      if (e.key === 'Tab' && focusLayer && trapFocus(e, focusLayer)) return;
      const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if (e.key === 'Escape') {
        if (els.modalBackdrop.classList.contains('open')) { closeModal(); return; }
        if (els.orderBackdrop.classList.contains('open')) { closeOrderSheet(); return; }
        if (state.settings.sidebarOpen && phoneMedia.matches) { toggleSidebar(false); return; }
        if (document.activeElement === els.searchInput && state.ui.search) {
          state.ui.search = '';
          els.searchInput.value = '';
          renderOutlineText();
          renderSearchResults();
          renderCanvas();
          persist();
          return;
        }
        if (isInput) {
          document.activeElement.blur();
          return;
        }
        if (state.settings.mainView !== 'board') return;
        const anyExpanded = Object.values(state.entities.items).some(item => item.nodeMode === 'expanded');
        if (anyExpanded) {
          pushHistory();
          Object.values(state.entities.items).forEach(item => { item.nodeMode = 'collapsed'; });
          persist();
          renderCanvas();
        }
        return;
      }
      if (els.modalBackdrop.classList.contains('open')
        || els.orderBackdrop.classList.contains('open')
        || els.actionsDropdown.classList.contains('open')) return;
      // Only take over undo/redo when the caret isn't in a text field, so
      // native per-character undo keeps working while editing content.
      if (!isInput) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
          e.preventDefault(); undo(); return;
        }
        if (((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'z') || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y')) {
          e.preventDefault(); redo(); return;
        }
      }
      if (isInput) return;
      if (e.key.toLowerCase() === 'q') {
        e.preventDefault();
        const item = getSelectedItem();
        if (item) addCustomQuestion(item.id);
      }
      if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        if (state.ui.activeQuestionId) addAnswerToQuestion(state.ui.activeQuestionId);
      }
      // Zoom hotkeys (plain keys, board-focused; don't fight browser zoom).
      if (state.settings.mainView === 'board') {
        if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomStep(1.25); }
        else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomStep(0.8); }
        else if (e.key === '0') { e.preventDefault(); resetZoom(); }
        else if (e.key.toLowerCase() === 'f') { e.preventDefault(); fitView(); }
      }
    });

    initPanEvents();
  }

  function trapFocus(event, container) {
    const focusable = [...container.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter(element => element.offsetParent !== null);
    if (!focusable.length) return false;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  render();
  setupEvents();
  if (loadedFromLegacyStorage) persist();
})();
