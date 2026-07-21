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
    outlineText: document.getElementById('outlineText'),
    outlineViewText: document.getElementById('outlineViewText'),
    selectionPill: document.getElementById('selectionPill'),
    boardView: document.getElementById('boardView'),
    outlineView: document.getElementById('outlineView'),
    canvasWorld: document.getElementById('canvasWorld'),
    connectionLayer: document.getElementById('connectionLayer'),
    toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
    collapseSidebarInnerBtn: document.getElementById('collapseSidebarInnerBtn'),
    boardViewBtn: document.getElementById('boardViewBtn'),
    outlineViewBtn: document.getElementById('outlineViewBtn'),
    undoBtn: document.getElementById('undoBtn'),
    redoBtn: document.getElementById('redoBtn'),
    searchInput: document.getElementById('searchInput'),
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

  let persistTimer = null;
  // Coalesce rapid writes (e.g. typing in a source field or the search box)
  // so we don't serialize the whole board on every keystroke.
  function schedulePersist(delay = 400) {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, delay);
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
        if (textEl) {
          textEl.addEventListener('focus', () => {
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
      if (answerId) addCustomQuestion(answerId);
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
    updateZoomReadout();
  }

  function updateZoomReadout() {
    if (els.resetZoomBtn) els.resetZoomBtn.textContent = Math.round(state.ui.canvas.scale * 100) + '%';
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
    const { panX, panY, scale } = state.ui.canvas;
    const newScale = clampScale(scale * factor);
    const actual = newScale / scale;
    state.ui.canvas.panX = px - (px - panX) * actual;
    state.ui.canvas.panY = py - (py - panY) * actual;
    state.ui.canvas.scale = newScale;
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
    state.ui.canvas.panX = panX;
    state.ui.canvas.panY = panY;
    state.ui.canvas.scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
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
      state.ui.canvas.panX -= dx;
      state.ui.canvas.panY -= dy;
      applyTransform();
    }
    schedulePersistCanvas();
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
    animateTransformOnce();
    setCanvasTransform(60, 60, 1.0);
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

  // Custom questions spawn a new card with a blank, editable title and drop the
  // cursor straight into it — no naming popup — so the discussion can continue
  // inline. An optional label lets callers pre-fill the title if they want.
  function addCustomQuestion(parentItemId, label = '') {
    const item = state.entities.items[parentItemId];
    if (!item) return;
    pushHistory();
    const q = createQuestionInternal(state, parentItemId, (label || '').trim());
    createItemInternal(state, { kind: 'answer', text: '', parentQuestionId: q.id });
    state.ui.activeQuestionId = q.id;
    state.ui.selectedItemId = parentItemId;
    persist();
    render();
    requestAnimationFrame(() => {
      zoomToNode(q.id);
      focusEditable(`[data-node-id="${q.id}"] [data-question-label="${q.id}"]`);
    });
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
    schedulePersist();
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

  // ── Outline text generation ───────────────────────────────────────────────

  function renderOutlineText() {
    const text = generateOutline();
    els.outlineText.textContent = text;
    els.outlineViewText.textContent = text;
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

  function renderSidebarState() {
    els.workspace.classList.toggle('sidebar-collapsed', !state.settings.sidebarOpen);
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
    els.searchInput.value = state.ui.search || '';
    renderSidebarState();
    renderViewMode();
    renderCanvas();
    renderOutlineText();
    updateButtons();
  }

  function updateButtons() {
    els.undoBtn.disabled = !state.history.past.length;
    els.redoBtn.disabled = !state.history.future.length;
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
    download('socrates-app.json', JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  }

  // Walk the item/question graph from the roots and fail if any node is
  // reached twice. A well-formed board is a tree, so a repeated node means a
  // cycle or shared reference — importing it would send the recursive layout
  // and meaningfulness walkers into unbounded recursion and crash the render.
  function assertTree(candidate) {
    const items = candidate.entities?.items || {};
    const questions = candidate.entities?.questions || {};
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
  }

  function addActionItem(dropdown, label, onClick, isDanger) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'examples-dropdown-item' + (isDanger ? ' action-danger' : '');
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
    els.boardViewBtn.addEventListener('click', () => setMainView('board'));
    els.outlineViewBtn.addEventListener('click', () => setMainView('outline'));
    els.undoBtn.addEventListener('click', undo);
    els.redoBtn.addEventListener('click', redo);
    els.resetZoomBtn?.addEventListener('click', resetZoom);
    els.zoomInBtn?.addEventListener('click', () => zoomStep(1.25));
    els.zoomOutBtn?.addEventListener('click', () => zoomStep(0.8));
    els.zoomFitBtn?.addEventListener('click', fitView);
    els.actionsBtn.addEventListener('click', e => { e.stopPropagation(); toggleActionsDropdown(); });
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

    document.addEventListener('keydown', e => {
      const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
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
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomStep(1.25); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomStep(0.8); }
      else if (e.key === '0') { e.preventDefault(); resetZoom(); }
      else if (e.key.toLowerCase() === 'f') { e.preventDefault(); fitView(); }
    });

    initPanEvents();
  }

  render();
  setupEvents();
})();
