export const isItemTarget = target => target?.kind === 'item';
export const isQuestionTarget = target => target?.kind === 'question';

export function targetExists(state, target) {
  if (!target?.id) return false;
  return isItemTarget(target)
    ? Boolean(state.entities.items[target.id])
    : isQuestionTarget(target)
      ? Boolean(state.entities.questions[target.id])
      : false;
}

export function targetLabel(state, target) {
  if (isItemTarget(target)) {
    const item = state.entities.items[target.id];
    if (!item) return 'Missing item';
    return (item.text || '').trim() || (item.kind === 'topic' ? 'Untitled topic' : 'Untitled answer');
  }
  const question = state.entities.questions[target?.id];
  return (question?.label || '').trim() || 'Untitled question';
}

export function getParentTarget(state, target) {
  if (isItemTarget(target)) {
    const item = state.entities.items[target.id];
    return item?.parentQuestionId
      ? { kind: 'question', id: item.parentQuestionId }
      : null;
  }
  if (isQuestionTarget(target)) {
    const question = state.entities.questions[target.id];
    return question?.parentItemId
      ? { kind: 'item', id: question.parentItemId }
      : null;
  }
  return null;
}

export function getChildTargets(state, target) {
  if (target?.kind === 'roots') {
    return (state.roots || [])
      .filter(id => state.entities.items[id])
      .map(id => ({ kind: 'item', id }));
  }
  if (isItemTarget(target)) {
    const item = state.entities.items[target.id];
    return (item?.questionIds || [])
      .filter(id => state.entities.questions[id])
      .map(id => ({ kind: 'question', id }));
  }
  if (isQuestionTarget(target)) {
    const question = state.entities.questions[target.id];
    return (question?.answerIds || [])
      .filter(id => state.entities.items[id])
      .map(id => ({ kind: 'item', id }));
  }
  return [];
}

export function getAncestorTargets(state, target) {
  const ancestors = [];
  let cursor = getParentTarget(state, target);
  const visited = new Set();
  while (cursor && !visited.has(`${cursor.kind}:${cursor.id}`)) {
    visited.add(`${cursor.kind}:${cursor.id}`);
    ancestors.unshift(cursor);
    cursor = getParentTarget(state, cursor);
  }
  return ancestors;
}

export function getSiblingTargets(state, target) {
  const parent = getParentTarget(state, target);
  if (parent) return getChildTargets(state, parent);
  if (isItemTarget(target)) {
    return (state.roots || [])
      .filter(id => state.entities.items[id])
      .map(id => ({ kind: 'item', id }));
  }
  return [];
}

export function getFocusContext(state, target) {
  if (!targetExists(state, target)) return null;
  return {
    ancestors: getAncestorTargets(state, target),
    parent: getParentTarget(state, target),
    siblings: getSiblingTargets(state, target),
    current: target,
    children: getChildTargets(state, target),
  };
}

function orderedIdsForParent(state, parent) {
  if (parent?.kind === 'roots') return state.roots;
  if (isItemTarget(parent)) return state.entities.items[parent.id]?.questionIds;
  if (isQuestionTarget(parent)) return state.entities.questions[parent.id]?.answerIds;
  return null;
}

export function moveChildInState(state, parent, childId, targetIndex) {
  const ids = orderedIdsForParent(state, parent);
  if (!Array.isArray(ids)) return false;
  const fromIndex = ids.indexOf(childId);
  if (fromIndex < 0 || ids.length < 2) return false;
  const boundedTarget = Math.max(0, Math.min(ids.length - 1, targetIndex));
  if (fromIndex === boundedTarget) return false;
  const [moved] = ids.splice(fromIndex, 1);
  ids.splice(boundedTarget, 0, moved);
  return true;
}

function ownTargetMatches(state, target, query) {
  if (isItemTarget(target)) {
    const item = state.entities.items[target.id];
    if (!item) return false;
    const sourceText = (item.sourceList || [])
      .flatMap(source => [source.label, source.url, source.note])
      .join(' ');
    return `${item.text || ''} ${sourceText}`.toLowerCase().includes(query);
  }
  const question = state.entities.questions[target?.id];
  return Boolean(question && (question.label || '').toLowerCase().includes(query));
}

export function findTreeMatches(state, rawQuery) {
  const query = String(rawQuery || '').trim().toLowerCase();
  if (!query) return { matches: new Set(), visible: new Set(), results: [] };

  const matches = new Set();
  const visible = new Set();
  const results = [];
  const visited = new Set();

  const visit = target => {
    const key = `${target.kind}:${target.id}`;
    if (visited.has(key) || !targetExists(state, target)) return false;
    visited.add(key);

    const ownMatch = ownTargetMatches(state, target, query);
    let childMatch = false;
    getChildTargets(state, target).forEach(child => {
      if (visit(child)) childMatch = true;
    });
    if (ownMatch) {
      matches.add(key);
      results.push({
        target,
        label: targetLabel(state, target),
        path: [...getAncestorTargets(state, target), target].map(part => targetLabel(state, part)),
      });
    }
    if (ownMatch || childMatch) visible.add(key);
    return ownMatch || childMatch;
  };

  (state.roots || []).forEach(id => visit({ kind: 'item', id }));
  return { matches, visible, results };
}
