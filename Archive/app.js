(function() {
  const STORAGE_KEY = 'strategyfractal-state-v2';
  const DEFAULT_QUESTIONS = ['Why', 'What', 'How', 'Who'];
  const THEMES = ['modern', 'sticky', 'playful', 'minimal'];
  const ZOOM_MIN = 0.12;
  const ZOOM_MAX = 2.0;
  const HALF_SPREAD = Math.PI * 5 / 12; // 75° fan, ~1 o'clock to ~5 o'clock
  const ARC_R_MIN = 120;
  const ROW_GAP = 16;
  const NODE_W_TOPIC = 260;
  const NODE_W_QUESTION = 280;

  const els = {
    workspace: document.getElementById('workspace'),
    topTopicsPanel: document.getElementById('topTopicsPanel'),
    rootLane: document.getElementById('rootLane'),
    outlineTree: document.getElementById('outlineTree'),
    outlineText: document.getElementById('outlineText'),
    outlineViewText: document.getElementById('outlineViewText'),
    selectionPill: document.getElementById('selectionPill'),
    boardView: document.getElementById('boardView'),
    outlineView: document.getElementById('outlineView'),
    canvasWorld: document.getElementById('canvasWorld'),
    connectionLayer: document.getElementById('connectionLayer'),
    newRootBtn: document.getElementById('newRootBtn'),
    addQuestionBtn: document.getElementById('addQuestionBtn'),
    addAnswerBtn: document.getElementById('addAnswerBtn'),
    toggleTopicsBtn: document.getElementById('toggleTopicsBtn'),
    toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
    collapseSidebarInnerBtn: document.getElementById('collapseSidebarInnerBtn'),
    boardViewBtn: document.getElementById('boardViewBtn'),
    outlineViewBtn: document.getElementById('outlineViewBtn'),
    themeSelect: document.getElementById('themeSelect'),
    undoBtn: document.getElementById('undoBtn'),
    redoBtn: document.getElementById('redoBtn'),
    copyOutlineBtn: document.getElementById('copyOutlineBtn'),
    exportJsonBtn: document.getElementById('exportJsonBtn'),
    importJsonBtn: document.getElementById('importJsonBtn'),
    clearBtn: document.getElementById('clearBtn'),
    searchInput: document.getElementById('searchInput'),
    downloadTextBtn: document.getElementById('downloadTextBtn'),
    modalBackdrop: document.getElementById('modalBackdrop'),
    modalTitle: document.getElementById('modalTitle'),
    modalSubtitle: document.getElementById('modalSubtitle'),
    modalTextarea: document.getElementById('modalTextarea'),
    modalActions: document.getElementById('modalActions'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    examplesBtn: document.getElementById('examplesBtn'),
    examplesDropdown: document.getElementById('examplesDropdown'),
    resetZoomBtn: document.getElementById('resetZoomBtn'),
    arrangeBtn: document.getElementById('arrangeBtn'),
  };

  let state = loadState() || createInitialState();
  let dragState = null;
  let toastTimer = null;
  let canvasPersistTimer = null;
  let examplesManifest = null;
  let isPanning = false;
  let panStart = { x: 0, y: 0 };
  let nodeDragState = null; // free-position canvas drag for question nodes

  // ── Initial state ─────────────────────────────────────────────────────────

  function createInitialState() {
    const s = {
      version: 2,
      settings: {
        theme: 'modern',
        mainView: 'board',
        sidebarOpen: false,
        showTopTopics: true,
      },
      ui: {
        selectedItemId: null,
        activeQuestionId: null,
        search: '',
        canvas: { panX: 60, panY: 60, scale: 1.0 },
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
    if (typeof state.settings.showTopTopics !== 'boolean') state.settings.showTopTopics = true;
    if (!state.ui) state.ui = { selectedItemId: null, activeQuestionId: null, search: '', canvas: { panX: 60, panY: 60, scale: 1.0 } };
    if (!state.ui.canvas) state.ui.canvas = { panX: 60, panY: 60, scale: 1.0 };
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
      if (!item.nodeMode) item.nodeMode = 'collapsed';
    });
    Object.values(state.entities.questions).forEach(q => {
      if (!Array.isArray(q.answerIds)) q.answerIds = [];
    });

    if (!state.entities.items[state.ui.selectedItemId]) {
      state.ui.selectedItemId = state.roots[0] || null;
    }
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
    } catch (err) {
      console.warn('Failed to save state:', err);
    }
  }

  function loadState() {
    try {
      const rawV2 = localStorage.getItem(STORAGE_KEY);
      const rawV1 = localStorage.getItem('strategyfractal-state-v1');
      const raw = rawV2 || rawV1;
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

  function isDefaultQuestionLabel(label) {
    return DEFAULT_QUESTIONS.some(q => normalizeLabel(q) === normalizeLabel(label));
  }

  function itemLabel(item) {
    const text = (item?.text || '').trim();
    return text || (item?.kind === 'topic' ? 'Untitled topic' : 'Untitled answer');
  }

  function getSelectedItem() {
    return state.entities.items[state.ui.selectedItemId] || null;
  }

  function findQuestionByLabel(parentItemId, label) {
    const item = state.entities.items[parentItemId];
    if (!item) return null;
    const target = normalizeLabel(label);
    return item.questionIds
      .map(id => state.entities.questions[id])
      .find(q => normalizeLabel(q?.label) === target) || null;
  }

  function setFocusedNode(itemId) {
    state.ui.selectedItemId = itemId;
    persist();
    renderRootLane();
    renderOutlineTree();
    renderOutlineText();
    updateButtons();
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
    const inText = (item.text || '').toLowerCase().includes(query);
    const inSources = item.sourceList.some(src => [src.label, src.url, src.note].join(' ').toLowerCase().includes(query));
    const inQuestions = item.questionIds.some(qId => (state.entities.questions[qId]?.label || '').toLowerCase().includes(query));
    return inText || inSources || inQuestions;
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
    return item.questionIds
      .map(id => state.entities.questions[id])
      .filter(q => q && isQuestionMeaningful(q));
  }

  function meaningfulAnswersForQuestion(question) {
    return question.answerIds
      .map(id => state.entities.items[id])
      .filter(answer => answer && isItemMeaningful(answer));
  }

  function countMeaningfulDescendants(itemId) {
    const item = state.entities.items[itemId];
    if (!item) return 0;
    let count = 0;
    item.questionIds.forEach(qid => {
      const q = state.entities.questions[qid];
      if (!q) return;
      q.answerIds.forEach(ansId => {
        const answer = state.entities.items[ansId];
        if (answer && isItemMeaningful(answer)) {
          count += 1 + countMeaningfulDescendants(ansId);
        }
      });
    });
    return count;
  }

  function countInstantiatedQuestions(item) {
    return item.questionIds.filter(qid => state.entities.questions[qid]).length;
  }

  // ── Layout engine ─────────────────────────────────────────────────────────

  function estimateItemHeight(item) {
    if (!item) return 44;
    if (item.nodeMode === 'collapsed') return 40;
    const srcH = item.sourceList.length * 64;
    return 90 + srcH;
  }

  function estimateQuestionHeight(question) {
    if (!question) return 44;
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
        layout.set(rootId, { x: 60, y: arcBottom, w: NODE_W_TOPIC, h });
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
      layout.set(rootId, { x: 60, y, w: NODE_W_TOPIC, h });
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

      layout.set(questionId, { x: qX, y: qY, w: NODE_W_QUESTION, h: qH });

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
        layout.set(answerId, { x: qX, y: bulletCenterY - ansSlotH / 2, w: NODE_W_QUESTION, h: ansSlotH, inline: true });
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

      if (isItem) {
        renderItemNode(nodeEl, state.entities.items[id]);
      } else {
        renderQuestionNode(nodeEl, state.entities.questions[id]);
        const q = state.entities.questions[id];
        if (q) {
          const handle = nodeEl.querySelector('.q-drag-handle');
          if (handle) {
            handle.addEventListener('mousedown', e => startNodeDrag(e, q.id, nodeEl, pos));
          }
        }
      }
    });
  }

  function renderItemNode(nodeEl, item) {
    const isSelected = state.ui.selectedItemId === item.id;
    const isExpanded = item.nodeMode === 'expanded';
    const dotColor = '#94a3b8';

    const chipActive = isSelected ? 'is-active' : '';

    if (!isExpanded) {
      nodeEl.innerHTML = `
        <div class="node-dot" style="background:${dotColor};"></div>
        <div class="node-topic-chip ${chipActive}" data-action="expand">
          <span>${escapeHtml(itemLabel(item))}</span>
        </div>
      `;
    } else {
      // Build spawn buttons — show which default questions already exist
      const spawnBtns = DEFAULT_QUESTIONS.map(label => {
        const cls = colorClassForLabel(label);
        return `<button type="button" class="spawn-btn ${cls}" data-spawn="${escapeHtml(label)}" title="Add ${escapeHtml(label)} branch">${escapeHtml(label)}</button>`;
      }).join('');

      const sourceHtml = buildSourceEditorHtml(item);

      nodeEl.innerHTML = `
        <div class="node-dot" style="background:${dotColor};"></div>
        <div class="node-topic-card ${chipActive}">
          <div class="node-card-header">
            <span class="chip blank" style="font-size:0.78rem;">Topic</span>
            <div class="node-chrome" style="display:flex;gap:6px;align-items:center;">
              <button type="button" class="soft" style="padding:5px 10px;font-size:0.78rem;" data-action="collapse">Collapse</button>
              <button type="button" class="soft" style="padding:5px 10px;font-size:0.78rem;" data-action="delete-item">Delete</button>
            </div>
          </div>
          <div class="node-card-body">
            <div class="node-text-area" contenteditable="true" spellcheck="true" data-item-text="${item.id}"></div>
            <div class="node-question-buttons">
              ${spawnBtns}
              <button type="button" class="spawn-btn custom" data-spawn-custom="1">+ Custom</button>
            </div>
            <div class="inline-sources" data-source-mount="${item.id}">${sourceHtml}</div>
            <div class="node-chrome" style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="soft" style="padding:5px 10px;font-size:0.78rem;" data-action="add-source">+ Source</button>
            </div>
          </div>
        </div>
      `;

      const textEl = nodeEl.querySelector(`[data-item-text="${item.id}"]`);
      setEditableContent(textEl, item.text, 'What\'s the topic?');
      attachEditable(textEl, value => updateItemText(item.id, value), pushHistoryOnce);
    }

    nodeEl.onclick = e => handleItemNodeClick(e, item);
    wireSourceListeners(nodeEl, item);
  }

  function renderQuestionNode(nodeEl, question) {
    const item = state.entities.items[question.parentItemId];
    const cc = colorClassForLabel(question.label);
    const isActive = state.ui.activeQuestionId === question.id;
    const activeClass = isActive ? 'is-active' : '';

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
            <div class="drag a-drag-handle" title="Drag to reorder answer">⋮⋮</div>
            <div class="bullet-marker"></div>
            <div class="answer-text-field" contenteditable="true" spellcheck="true" data-item-text="${answer.id}"></div>
          </div>
          <div class="answer-bullet-actions node-chrome">
            ${childSpawnBtns}
            <button type="button" class="branch-spawn-btn custom" data-child-spawn-custom="1" data-answer-id="${answerId}">Custom →</button>
            <button type="button" class="branch-spawn-btn" style="color:var(--muted);" data-delete-answer="${answerId}">✕</button>
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
          <div class="drag q-drag-handle" title="Drag to reorder question">⋮⋮</div>
          <div class="node-q-label" contenteditable="true" spellcheck="false" data-question-label="${question.id}"></div>
          <div class="node-chrome" style="display:flex;gap:4px;flex-shrink:0;">
            <button type="button" class="soft" style="padding:4px 8px;font-size:0.75rem;" data-action="delete-question">✕</button>
          </div>
        </div>
        <div class="node-q-body">
          ${answersHtml || '<div class="branch-empty" style="font-size:0.84rem;">No answers yet.</div>'}
        </div>
        <div class="node-q-footer node-chrome">
          <button type="button" class="soft" style="padding:5px 10px;font-size:0.78rem;" data-action="add-answer">+ Answer</button>
          ${canSplit ? `<button type="button" class="soft split-btn" data-action="split-bullets">Split into bullets</button>` : ''}
        </div>
      </div>
    `;

    // Wire question label editable
    const labelEl = nodeEl.querySelector(`[data-question-label="${question.id}"]`);
    if (labelEl) {
      setEditableContent(labelEl, question.label, 'Question…');
      attachEditable(labelEl, value => updateQuestionLabel(question.id, value), pushHistoryOnce);
    }

    // Wire answer text editables and bullet drag-to-reorder
    question.answerIds.forEach(answerId => {
      const answer = state.entities.items[answerId];
      if (!answer) return;
      const textEl = nodeEl.querySelector(`[data-item-text="${answer.id}"]`);
      if (textEl) {
        setEditableContent(textEl, answer.text, 'Write an answer…');
        attachEditable(textEl, value => updateItemText(answerId, value), pushHistoryOnce);
      }
      const bulletEl = nodeEl.querySelector(`.answer-bullet[data-answer-id="${answerId}"]`);
      if (bulletEl) {
        const dragType = 'a-' + question.id;
        bulletEl.dataset.dragType = dragType;
        bulletEl.draggable = true;
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
    if (spawnLabel) {
      e.stopPropagation();
      spawnQuestion(item.id, spawnLabel);
      return;
    }
    if (spawnCustom) {
      e.stopPropagation();
      addCustomQuestion(item.id, '');
      return;
    }
    if (e.target.closest('[data-action="delete-source"]')) {
      e.stopPropagation();
      const sourceId = e.target.closest('[data-source-id]')?.dataset?.sourceId;
      if (sourceId) deleteSource(item.id, sourceId);
      return;
    }
    // Click on chip or card background expands
    if (!e.target.closest('[contenteditable], input, button')) {
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
      if (answerId) addCustomQuestion(answerId, '');
      return;
    }
    if (deleteAnswerId) {
      e.stopPropagation();
      deleteItem(deleteAnswerId);
      return;
    }

    // Clicking the card activates this question
    if (!e.target.closest('[contenteditable], input, button')) {
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

  function applyTransform() {
    const { panX, panY, scale } = state.ui.canvas;
    const t = `translate(${panX}px, ${panY}px) scale(${scale})`;
    els.canvasWorld.style.transform = t;
    els.connectionLayer.style.transform = t;
    els.connectionLayer.style.transformOrigin = '0 0';
  }

  function updateFidelityClass() {
    const scale = state.ui.canvas.scale;
    els.canvasWorld.classList.remove('fidelity-full', 'fidelity-medium', 'fidelity-abstract');
    if (scale >= 0.6) els.canvasWorld.classList.add('fidelity-full');
    else if (scale >= 0.3) els.canvasWorld.classList.add('fidelity-medium');
    else els.canvasWorld.classList.add('fidelity-abstract');
  }

  function setCanvasTransform(panX, panY, scale) {
    state.ui.canvas.panX = panX;
    state.ui.canvas.panY = panY;
    state.ui.canvas.scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
    applyTransform();
    updateFidelityClass();
    persist();
  }

  function handleWheel(e) {
    e.preventDefault();
    const rect = els.boardView.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.909;
    const { panX, panY, scale } = state.ui.canvas;
    const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale * zoomFactor));
    const actualFactor = newScale / scale;
    state.ui.canvas.panX = mouseX - (mouseX - panX) * actualFactor;
    state.ui.canvas.panY = mouseY - (mouseY - panY) * actualFactor;
    state.ui.canvas.scale = newScale;
    applyTransform();
    updateFidelityClass();
    clearTimeout(canvasPersistTimer);
    canvasPersistTimer = setTimeout(persist, 300);
  }

  function startNodeDrag(e, questionId, nodeEl, pos) {
    e.stopPropagation();
    e.preventDefault();
    const rect = els.boardView.getBoundingClientRect();
    const { panX, panY, scale } = state.ui.canvas;
    const mx = (e.clientX - rect.left - panX) / scale;
    const my = (e.clientY - rect.top  - panY) / scale;
    nodeDragState = {
      questionId, nodeEl,
      startMX: mx, startMY: my,
      startX: pos.x, startY: pos.y,
    };
    nodeEl.style.cursor = 'grabbing';
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

    els.boardView.addEventListener('wheel', handleWheel, { passive: false });

    els.boardView.addEventListener('click', e => {
      if (didPan) { didPan = false; return; }
      if (e.target.closest('.node')) return;
      if (state.ui.selectedItemId || state.ui.activeQuestionId) {
        state.ui.selectedItemId = null;
        state.ui.activeQuestionId = null;
        persist();
        renderCanvas();
      }
    });

    els.boardView.addEventListener('mousedown', e => {
      if (e.target.closest('[data-node-id], button, [contenteditable], input, select')) return;
      isPanning = true;
      didPan = false;
      panStart = { x: e.clientX - state.ui.canvas.panX, y: e.clientY - state.ui.canvas.panY };
      els.boardView.classList.add('is-panning');
    });

    window.addEventListener('mousemove', e => {
      if (nodeDragState) {
        const rect = els.boardView.getBoundingClientRect();
        const { panX, panY, scale } = state.ui.canvas;
        const mx = (e.clientX - rect.left - panX) / scale;
        const my = (e.clientY - rect.top  - panY) / scale;
        const newX = nodeDragState.startX + (mx - nodeDragState.startMX);
        const newY = nodeDragState.startY + (my - nodeDragState.startMY);
        const q = state.entities.questions[nodeDragState.questionId];
        if (q) { q.manualX = newX; q.manualY = newY; }
        nodeDragState.nodeEl.style.left = newX + 'px';
        nodeDragState.nodeEl.style.top  = newY + 'px';
        renderConnections(computeLayout());
        return;
      }
      if (!isPanning) return;
      didPan = true;
      const newPanX = e.clientX - panStart.x;
      const newPanY = e.clientY - panStart.y;
      state.ui.canvas.panX = newPanX;
      state.ui.canvas.panY = newPanY;
      applyTransform();
    });

    window.addEventListener('mouseup', () => {
      if (nodeDragState) {
        nodeDragState.nodeEl.style.cursor = '';
        persist();
        renderCanvas();
        nodeDragState = null;
        return;
      }
      if (!isPanning) return;
      isPanning = false;
      els.boardView.classList.remove('is-panning');
      persist();
    });
  }

  function resetZoom() {
    setCanvasTransform(60, 60, 1.0);
    renderCanvas();
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
    setCanvasTransform(panX, panY, targetScale);
    renderCanvas();
  }

  // ── Node mutation helpers ─────────────────────────────────────────────────

  function addRoot() {
    pushHistory();
    const item = createItemInternal(state, { kind: 'topic', text: '' });
    item.nodeMode = 'expanded';
    state.roots.push(item.id);
    state.ui.selectedItemId = item.id;
    persist();
    render();
    requestAnimationFrame(() => focusEditable(`[data-item-text="${item.id}"]`));
  }

  function spawnQuestion(parentItemId, label) {
    const item = state.entities.items[parentItemId];
    if (!item) return;
    pushHistory();
    const q = createQuestionInternal(state, parentItemId, label);
    // Add a first blank answer item
    createItemInternal(state, { kind: 'answer', text: '', parentQuestionId: q.id });
    state.ui.activeQuestionId = q.id;
    state.ui.selectedItemId = parentItemId;
    persist();
    render();
    requestAnimationFrame(() => {
      zoomToNode(q.id);
      const answerEl = document.querySelector(`[data-node-id="${q.id}"] [data-item-text]`);
      if (answerEl) { answerEl.focus(); }
    });
  }

  function addCustomQuestion(parentItemId, label) {
    const item = state.entities.items[parentItemId];
    if (!item) return;
    if (!label) {
      openModal({
        title: 'New Custom Question',
        subtitle: 'Name this custom question branch.',
        initialValue: 'Custom',
        actions: [
          { label: 'Add', primary: true, onClick: value => {
            closeModal();
            _commitAddCustomQuestion(parentItemId, (value || '').trim() || 'Custom');
          }},
          { label: 'Cancel', onClick: closeModal },
        ],
      });
      return;
    }
    _commitAddCustomQuestion(parentItemId, (label || '').trim() || 'Custom');
  }

  function _commitAddCustomQuestion(parentItemId, chosen) {
    pushHistory();
    const q = createQuestionInternal(state, parentItemId, chosen);
    createItemInternal(state, { kind: 'answer', text: '', parentQuestionId: q.id });
    state.ui.activeQuestionId = q.id;
    persist();
    render();
  }

  function addAnswerToQuestion(questionId) {
    const q = state.entities.questions[questionId];
    if (!q) return;
    pushHistory();
    const item = createItemInternal(state, { kind: 'answer', text: '', parentQuestionId: questionId });
    state.ui.activeQuestionId = questionId;
    persist();
    renderCanvas();
    requestAnimationFrame(() => focusEditable(`[data-node-id="${questionId}"] [data-item-text="${item.id}"]`));
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
    el.focus();
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
    renderRootLane();
    renderOutlineTree();
    renderOutlineText();
    updateButtons();
  }

  function updateQuestionLabel(questionId, label) {
    const q = state.entities.questions[questionId];
    if (!q) return;
    q.label = label;
    q.updatedAt = Date.now();
    persist();
    renderOutlineTree();
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
    renderCanvas();
  }

  function updateSource(itemId, sourceId, key, value) {
    const item = state.entities.items[itemId];
    if (!item) return;
    if (!['label', 'url', 'note'].includes(key)) return;
    const source = item.sourceList.find(s => s.id === sourceId);
    if (!source) return;
    source[key] = value;
    item.updatedAt = Date.now();
    persist();
  }

  function deleteSource(itemId, sourceId) {
    const item = state.entities.items[itemId];
    if (!item) return;
    pushHistory();
    item.sourceList = item.sourceList.filter(s => s.id !== sourceId);
    persist();
    renderCanvas();
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

  // ── Root lane (topic strip) ───────────────────────────────────────────────

  function renderRootLane() {
    els.rootLane.innerHTML = '';
    if (!state.roots.length) {
      els.rootLane.innerHTML = '<div class="empty-state">No topics yet. Click <strong>+ New Topic</strong> to start.</div>';
      return;
    }
    let visibleCount = 0;
    state.roots.forEach((itemId, index) => {
      const item = state.entities.items[itemId];
      if (!item) return;
      if (!filterMatchesItem(item)) return;
      visibleCount += 1;
      const branchCount = countMeaningfulDescendants(itemId);
      const liveQuestions = countInstantiatedQuestions(item);
      const card = document.createElement('div');
      card.className = 'root-chip' + (state.ui.selectedItemId === itemId ? ' active' : '');
      card.draggable = true;
      card.dataset.dragType = 'roots';
      card.dataset.id = itemId;
      card.innerHTML = `
        <div class="sort-row">
          <div class="sort-left">
            <div class="drag" title="Drag to reorder">⋮⋮</div>
            <div class="root-chip-label" contenteditable="true" data-item-text="${item.id}"></div>
          </div>
          <small>#${index + 1}</small>
        </div>
        <small>${liveQuestions} question branch${liveQuestions === 1 ? '' : 'es'} • ${branchCount} populated descendant${branchCount === 1 ? '' : 's'}</small>
      `;
      card.addEventListener('click', e => {
        if (e.target.closest('[data-item-text]')) return;
        setFocusedNode(itemId);
        zoomToNode(itemId);
      });
      wireDragAndDrop(card, state.roots, itemId, () => render());
      els.rootLane.appendChild(card);

      const labelEl = card.querySelector(`[data-item-text="${item.id}"]`);
      setEditableContent(labelEl, item.text, 'Untitled topic');
      labelEl.addEventListener('mousedown', e => e.stopPropagation());
      labelEl.addEventListener('focus', () => {
        pushHistoryOnce();
        if (state.ui.selectedItemId !== itemId) {
          state.ui.selectedItemId = itemId;
          document.querySelectorAll('.root-chip').forEach(c =>
            c.classList.toggle('active', c.dataset.id === itemId)
          );
          persist();
        }
        if (labelEl.dataset.empty === 'true') labelEl.textContent = '';
      });
      labelEl.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') labelEl.blur();
      });
      labelEl.addEventListener('blur', () => updateItemText(itemId, getEditableText(labelEl)));
      labelEl.addEventListener('input', () => toggleEditablePlaceholder(labelEl));
    });
    if (!visibleCount) {
      els.rootLane.innerHTML = '<div class="empty-state">No matches for the current search.</div>';
    }
  }

  // ── Outline tree ──────────────────────────────────────────────────────────

  function renderOutlineTree() {
    els.outlineTree.innerHTML = '';
    if (!state.roots.length) {
      els.outlineTree.innerHTML = '<div class="empty-state">Nothing on the board yet.</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    state.roots.forEach(rootId => {
      const item = state.entities.items[rootId];
      if (!item || !filterMatchesItem(item)) return;
      frag.appendChild(renderOutlineItem(item));
    });
    if (!frag.childNodes.length) {
      els.outlineTree.innerHTML = '<div class="empty-state">No matches for the current search.</div>';
    } else {
      els.outlineTree.appendChild(frag);
    }
  }

  function renderOutlineItem(item) {
    const wrapper = document.createElement('div');
    wrapper.className = 'outline-node';
    const row = document.createElement('div');
    row.className = 'outline-item-row';
    row.innerHTML = `
      <button class="outline-select ${state.ui.selectedItemId === item.id ? 'active' : ''}">${escapeHtml(itemLabel(item))}</button>
      <span class="pill">${item.kind}</span>
      ${item.parentQuestionId ? `<span class="pill">via ${escapeHtml(state.entities.questions[item.parentQuestionId]?.label || 'question')}</span>` : '<span class="pill">top-level</span>'}
    `;
    row.querySelector('.outline-select').addEventListener('click', () => {
      setFocusedNode(item.id);
      zoomToNode(item.id);
    });
    wrapper.appendChild(row);

    meaningfulQuestionsForItem(item).forEach(q => {
      const qNode = document.createElement('div');
      qNode.className = 'outline-node';
      const cc = colorClassForLabel(q.label);
      qNode.innerHTML = `
        <div class="outline-question-row">
          <button class="outline-select ${state.ui.activeQuestionId === q.id ? 'active' : ''}">? ${escapeHtml(q.label || 'Blank')}</button>
          <span class="chip ${cc}">${escapeHtml(q.label || 'Blank')}</span>
          <span class="pill">${meaningfulAnswersForQuestion(q).length}</span>
        </div>
      `;
      qNode.querySelector('.outline-select').addEventListener('click', () => {
        state.ui.activeQuestionId = q.id;
        setFocusedNode(item.id);
        zoomToNode(q.id);
        persist();
      });
      meaningfulAnswersForQuestion(q).forEach(answer => {
        qNode.appendChild(renderOutlineItem(answer));
      });
      wrapper.appendChild(qNode);
    });
    return wrapper;
  }

  function renderOutlineText() {
    const text = generateBreadthThenDrillOutline();
    els.outlineText.textContent = text;
    els.outlineViewText.textContent = text;
  }

  // ── Outline text generation ───────────────────────────────────────────────

  function generateBreadthThenDrillOutline() {
    const roots = state.roots
      .map(id => state.entities.items[id])
      .filter(Boolean)
      .filter(item => filterMatchesItem(item));
    if (!roots.length) return 'No topics yet.';
    const lines = [];
    renderSiblingGroup(lines, roots, 0, 'Top-level Topics');
    return lines.join('\n');
  }

  function renderSiblingGroup(lines, items, depth, headingLabel) {
    const indent = '  '.repeat(depth);
    if (headingLabel) lines.push(`${indent}${headingLabel}:`);
    items.forEach((item, idx) => {
      lines.push(`${indent}- ${idx + 1}. ${flattenInline(itemLabel(item))}`);
    });
    lines.push('');
    items.forEach((item, idx) => {
      lines.push(`${indent}${idx + 1}) ${flattenInline(itemLabel(item))}`);
      if (item.sourceList?.length) {
        item.sourceList
          .filter(src => [src.label, src.url, src.note].some(Boolean))
          .forEach(src => {
            const parts = [src.label, src.url, src.note].filter(Boolean).map(flattenInline);
            lines.push(`${indent}  [source] ${parts.join(' | ')}`);
          });
      }
      renderQuestionGroups(lines, item, depth + 1);
      lines.push('');
    });
  }

  function renderQuestionGroups(lines, item, depth) {
    const indent = '  '.repeat(depth);
    const questions = meaningfulQuestionsForItem(item);
    if (!questions.length) {
      lines.push(`${indent}(no populated questions)`);
      return;
    }
    questions.forEach((q, qIndex) => {
      const label = flattenInline(q.label || 'Blank question');
      lines.push(`${indent}? ${qIndex + 1}. ${label}`);
      const answers = meaningfulAnswersForQuestion(q);
      if (!answers.length) {
        lines.push(`${indent}  (no populated answers)`);
        return;
      }
      answers.forEach((answer, idx) => {
        lines.push(`${indent}  - ${idx + 1}. ${flattenInline(itemLabel(answer))}`);
      });
      lines.push('');
      answers.forEach((answer, idx) => {
        lines.push(`${indent}  ${idx + 1}) ${flattenInline(itemLabel(answer))}`);
        if (answer.sourceList?.length) {
          answer.sourceList
            .filter(src => [src.label, src.url, src.note].some(Boolean))
            .forEach(src => {
              const parts = [src.label, src.url, src.note].filter(Boolean).map(flattenInline);
              lines.push(`${indent}    [source] ${parts.join(' | ')}`);
            });
        }
        renderQuestionGroups(lines, answer, depth + 2);
        lines.push('');
      });
    });
  }

  function flattenInline(text) {
    return String(text || '').replace(/\s+/g, ' ').trim() || '[blank]';
  }

  // ── View / theme state ────────────────────────────────────────────────────

  function setTheme(theme) {
    if (!THEMES.includes(theme)) theme = 'modern';
    state.settings.theme = theme;
    document.body.className = 'theme-' + theme;
    persist();
  }

  function setMainView(view) {
    state.settings.mainView = view === 'outline' ? 'outline' : 'board';
    renderViewMode();
    persist();
  }

  function toggleSidebar(forceValue) {
    state.settings.sidebarOpen = typeof forceValue === 'boolean' ? forceValue : !state.settings.sidebarOpen;
    renderSidebarState();
    persist();
  }

  function toggleTopTopics(forceValue) {
    state.settings.showTopTopics = typeof forceValue === 'boolean' ? forceValue : !state.settings.showTopTopics;
    renderTopTopicsState();
    persist();
  }

  function renderSidebarState() {
    els.workspace.classList.toggle('sidebar-collapsed', !state.settings.sidebarOpen);
  }

  function renderTopTopicsState() {
    els.topTopicsPanel.classList.toggle('hidden-panel', !state.settings.showTopTopics);
    els.toggleTopicsBtn.textContent = state.settings.showTopTopics ? 'Hide Topics' : 'Show Topics';
  }

  function renderViewMode() {
    const board = state.settings.mainView !== 'outline';
    els.boardView.classList.toggle('hidden', !board);
    els.outlineView.classList.toggle('hidden', board);
    els.boardViewBtn.classList.toggle('primary', board);
    els.outlineViewBtn.classList.toggle('primary', !board);
    els.boardViewBtn.classList.toggle('soft', !board);
    els.outlineViewBtn.classList.toggle('soft', board);
  }

  // ── Main render ───────────────────────────────────────────────────────────

  function render() {
    normalizeState();
    document.body.className = 'theme-' + (state.settings.theme || 'modern');
    els.themeSelect.value = state.settings.theme || 'modern';
    els.searchInput.value = state.ui.search || '';
    renderSidebarState();
    renderTopTopicsState();
    renderViewMode();
    renderRootLane();
    renderCanvas();
    renderOutlineTree();
    renderOutlineText();
    updateButtons();
  }

  function updateButtons() {
    els.undoBtn.disabled = !state.history.past.length;
    els.redoBtn.disabled = !state.history.future.length;
    els.addAnswerBtn.disabled = !state.ui.activeQuestionId;
    els.selectionPill.textContent = getSelectedItem() ? itemLabel(getSelectedItem()) : 'No selection';
  }

  // ── Editable helpers ──────────────────────────────────────────────────────

  let pushedThisFocus = false;

  function pushHistoryOnce() {
    if (pushedThisFocus) return;
    pushedThisFocus = true;
    pushHistory();
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

  // ── Drag and drop (root lane) ─────────────────────────────────────────────

  function wireDragAndDrop(element, arrayRef, itemId, onDone) {
    element.addEventListener('dragstart', event => {
      dragState = { dragType: element.dataset.dragType, itemId, arrayRef };
      event.dataTransfer.effectAllowed = 'move';
      element.classList.add('dragging');
    });
    element.addEventListener('dragend', () => {
      dragState = null;
      element.classList.remove('dragging');
    });
    element.addEventListener('dragover', event => {
      if (!dragState) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    element.addEventListener('drop', event => {
      if (!dragState) return;
      event.preventDefault();
      if (element.dataset.dragType !== dragState.dragType) return;
      const from = arrayRef.indexOf(dragState.itemId);
      const to = arrayRef.indexOf(itemId);
      if (from === -1 || to === -1 || from === to) return;
      pushHistory();
      arrayRef.splice(to, 0, arrayRef.splice(from, 1)[0]);
      persist();
      onDone?.();
    });
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
    toastTimer = setTimeout(() => {
      pill.textContent = getSelectedItem() ? itemLabel(getSelectedItem()) : original;
    }, 1800);
  }

  // ── Modal ─────────────────────────────────────────────────────────────────

  function openModal(config) {
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
    setTimeout(() => {
      if (!config.hideTextarea) els.modalTextarea.focus();
      else els.modalActions.querySelector('button')?.focus();
    }, 10);
  }

  function closeModal() {
    els.modalBackdrop.classList.remove('open');
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
    download('strategyfractal.json', JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  }

  function importJson(raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.roots || !parsed.entities) throw new Error('Invalid JSON structure');
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

  async function toggleExamplesDropdown() {
    const dropdown = els.examplesDropdown;
    if (dropdown.classList.contains('open')) {
      dropdown.classList.remove('open');
      return;
    }
    dropdown.innerHTML = '<div class="examples-dropdown-message">Loading…</div>';
    dropdown.classList.add('open');
    const examples = await loadExamplesManifest();
    dropdown.innerHTML = '';
    if (!examples.length) {
      dropdown.innerHTML = '<div class="examples-dropdown-message">No examples available.</div>';
      return;
    }
    examples.forEach(example => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'examples-dropdown-item';
      btn.textContent = example.name;
      btn.addEventListener('click', () => loadExample(example.file, example.name));
      dropdown.appendChild(btn);
    });
  }

  async function loadExample(file, name) {
    els.examplesDropdown.classList.remove('open');
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
    els.newRootBtn.addEventListener('click', addRoot);
    els.addQuestionBtn.addEventListener('click', () => {
      const item = getSelectedItem();
      if (item) addCustomQuestion(item.id, '');
    });
    els.addAnswerBtn.addEventListener('click', () => {
      if (state.ui.activeQuestionId) addAnswerToQuestion(state.ui.activeQuestionId);
    });
    els.toggleTopicsBtn.addEventListener('click', () => toggleTopTopics());
    els.toggleSidebarBtn.addEventListener('click', () => toggleSidebar());
    els.collapseSidebarInnerBtn.addEventListener('click', () => toggleSidebar(false));
    els.boardViewBtn.addEventListener('click', () => setMainView('board'));
    els.outlineViewBtn.addEventListener('click', () => setMainView('outline'));
    els.themeSelect.addEventListener('change', e => setTheme(e.target.value));
    els.undoBtn.addEventListener('click', undo);
    els.redoBtn.addEventListener('click', redo);
    els.resetZoomBtn.addEventListener('click', resetZoom);
    els.arrangeBtn?.addEventListener('click', arrangeLayout);
    els.copyOutlineBtn.addEventListener('click', () => copyToClipboard(generateBreadthThenDrillOutline(), 'Outline copied.'));
    els.exportJsonBtn.addEventListener('click', exportJson);
    els.importJsonBtn.addEventListener('click', () => openModal({
      title: 'Import StrategyFractal JSON',
      subtitle: 'Paste a previously exported JSON payload to resume a session.',
      actions: [
        { label: 'Import', primary: true, onClick: importJson },
        { label: 'Cancel', onClick: closeModal },
      ],
    }));
    els.clearBtn.addEventListener('click', clearBoard);
    els.searchInput.addEventListener('input', e => {
      state.ui.search = e.target.value;
      persist();
      renderRootLane();
      renderOutlineTree();
      renderOutlineText();
    });
    els.downloadTextBtn.addEventListener('click', () => download('strategyfractal-outline.txt', generateBreadthThenDrillOutline()));
    els.closeModalBtn.addEventListener('click', closeModal);
    els.modalBackdrop.addEventListener('click', e => {
      if (e.target === els.modalBackdrop) closeModal();
    });
    els.examplesBtn.addEventListener('click', e => {
      e.stopPropagation();
      toggleExamplesDropdown();
    });
    document.addEventListener('click', e => {
      if (!els.examplesDropdown.classList.contains('open')) return;
      if (!els.examplesBtn.contains(e.target) && !els.examplesDropdown.contains(e.target)) {
        els.examplesDropdown.classList.remove('open');
      }
    });

    document.addEventListener('keydown', e => {
      const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault(); undo(); return;
      }
      if (((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'z') || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y')) {
        e.preventDefault(); redo(); return;
      }
      if (e.key === 'Escape') {
        if (els.modalBackdrop.classList.contains('open')) { closeModal(); return; }
        const anyExpanded = Object.values(state.entities.items).some(item => item.nodeMode === 'expanded');
        if (anyExpanded) {
          pushHistory();
          Object.values(state.entities.items).forEach(item => { item.nodeMode = 'collapsed'; });
          persist();
          renderCanvas();
        }
        return;
      }
      if (isInput) return;
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); addRoot(); }
      if (e.key.toLowerCase() === 'q') {
        e.preventDefault();
        const item = getSelectedItem();
        if (item) addCustomQuestion(item.id, '');
      }
      if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        if (state.ui.activeQuestionId) addAnswerToQuestion(state.ui.activeQuestionId);
      }
    });

    initPanEvents();
  }

  render();
  setupEvents();
})();
