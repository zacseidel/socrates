/* ═══════════════════════════════════════════════════════
   DATA MODEL & UTILITIES
═══════════════════════════════════════════════════════ */

// More robust UID for software engineering context
function uid() { 
  return self.crypto?.randomUUID ? self.crypto.randomUUID().split('-')[0] : Math.random().toString(36).slice(2, 9);
}

function defaultTree() {
  return {
    id: 'root0', label: 'Starting Note Topic',
    notes: 'Core objective or primary question.',
    type: 'root', priority: 0, collapsed: false,
    children: [
      { id: uid(), label: 'Key Constraints', notes: '', type: 'question', priority: 0, collapsed: false, children: [] },
      { id: uid(), label: 'Proposed Solutions', notes: '', type: 'question', priority: 1, collapsed: false, children: [] }
    ]
  };
}

let treeData = defaultTree();
let selectedId = null;

/* ── Tree Search & Sorting ── */
function findNode(root, id) {
  if (root.id === id) return root;
  for (const c of root.children || []) { const f = findNode(c, id); if (f) return f; }
  return null;
}

function findParent(root, id) {
  for (const c of root.children || []) {
    if (c.id === id) return root;
    const f = findParent(c, id); if (f) return f;
  }
  return null;
}

function sortedKids(node) {
  return [...(node.children || [])].sort((a, b) => a.priority - b.priority);
}

function reindex(parent) {
  if (!parent?.children) return;
  parent.children.sort((a, b) => a.priority - b.priority);
  parent.children.forEach((c, i) => c.priority = i);
}

/* ═══════════════════════════════════════════════════════
   D3 RENDERING ENGINE
═══════════════════════════════════════════════════════ */
const NW = 164; const NH = 40; const HGAP = 72; const VGAP = 16;
const svg = d3.select('#graph');
let gRoot, gLinks, gNodes, zoom;

function initSVG() {
  svg.selectAll('*').remove();
  zoom = d3.zoom().scaleExtent([0.07, 4]).on('zoom', e => gRoot.attr('transform', e.transform));
  svg.call(zoom).on('dblclick.zoom', null);
  gRoot = svg.append('g').attr('class', 'g-root');
  gLinks = gRoot.append('g').attr('class', 'g-links');
  gNodes = gRoot.append('g').attr('class', 'g-nodes');
}

function buildGraph(fitAfter) {
  if (!gRoot) initSVG();
  const hier = d3.hierarchy(treeData, d => d.collapsed ? null : sortedKids(d));
  d3.tree().nodeSize([NH + VGAP, NW + HGAP])(hier);

  // Nodes & Links mapping (truncated: same D3 logic as index-2.html)
  renderNodes(hier);
  renderLinks(hier);

  if (fitAfter) setTimeout(fitView, 120);
}

/* ═══════════════════════════════════════════════════════
   UI EVENT HANDLERS
═══════════════════════════════════════════════════════ */
document.getElementById('btn-save-node').addEventListener('click', () => {
  if (!selectedId) return;
  const node = findNode(treeData, selectedId);
  if (!node) return;
  node.label = document.getElementById('field-label').value.trim() || node.label;
  node.notes = document.getElementById('field-notes').value.trim();
  node.type = document.getElementById('field-type').value;
  buildGraph(); renderOutline(); showToast('Changes Saved');
});

function selectNode(id) {
  selectedId = id;
  const node = findNode(treeData, id);
  document.getElementById('edit-panel').classList.remove('collapsed');
  document.getElementById('edit-empty').style.display = 'none';
  document.getElementById('node-form').style.display = 'flex';
  document.getElementById('field-label').value = node.label;
  document.getElementById('field-notes').value = node.notes;
  buildGraph(); renderOutline();
}

// Initialization
initSVG();
buildGraph(true);
renderOutline();