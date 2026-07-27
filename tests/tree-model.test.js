import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findTreeMatches,
  getFocusContext,
  moveChildInState,
  targetLabel,
} from '../tree-model.js';

function sampleState() {
  return {
    roots: ['topic'],
    entities: {
      items: {
        topic: {
          id: 'topic',
          kind: 'topic',
          text: 'Launch strategy',
          parentQuestionId: null,
          questionIds: ['why', 'how'],
          sourceList: [],
        },
        reasonA: {
          id: 'reasonA',
          kind: 'answer',
          text: 'Reach new customers',
          parentQuestionId: 'why',
          questionIds: ['who'],
          sourceList: [],
        },
        reasonB: {
          id: 'reasonB',
          kind: 'answer',
          text: 'Grow recurring revenue',
          parentQuestionId: 'why',
          questionIds: [],
          sourceList: [],
        },
        audience: {
          id: 'audience',
          kind: 'answer',
          text: 'Operations leaders',
          parentQuestionId: 'who',
          questionIds: [],
          sourceList: [{ label: 'Interview', url: '', note: 'Mobile workflow' }],
        },
      },
      questions: {
        why: {
          id: 'why',
          parentItemId: 'topic',
          label: 'Why',
          answerIds: ['reasonA', 'reasonB'],
        },
        how: {
          id: 'how',
          parentItemId: 'topic',
          label: 'How',
          answerIds: [],
        },
        who: {
          id: 'who',
          parentItemId: 'reasonA',
          label: 'Who',
          answerIds: ['audience'],
        },
      },
    },
  };
}

test('focus context keeps complete breadcrumbs and only immediate relations', () => {
  const state = sampleState();
  const context = getFocusContext(state, { kind: 'item', id: 'audience' });
  assert.deepEqual(
    context.ancestors.map(target => targetLabel(state, target)),
    ['Launch strategy', 'Why', 'Reach new customers', 'Who'],
  );
  assert.equal(targetLabel(state, context.parent), 'Who');
  assert.deepEqual(context.children, []);
  assert.deepEqual(context.siblings, [{ kind: 'item', id: 'audience' }]);
});

test('moving children updates the authoritative sibling array', () => {
  const state = sampleState();
  assert.equal(moveChildInState(state, { kind: 'question', id: 'why' }, 'reasonB', 0), true);
  assert.deepEqual(state.entities.questions.why.answerIds, ['reasonB', 'reasonA']);
  assert.equal(moveChildInState(state, { kind: 'question', id: 'why' }, 'reasonB', 0), false);
});

test('root ordering uses the same operation', () => {
  const state = sampleState();
  state.roots.push('reasonB');
  assert.equal(moveChildInState(state, { kind: 'roots' }, 'reasonB', 0), true);
  assert.deepEqual(state.roots, ['reasonB', 'topic']);
});

test('recursive search finds deep content and retains its ancestor path', () => {
  const state = sampleState();
  const result = findTreeMatches(state, 'mobile workflow');
  assert.equal(result.matches.has('item:audience'), true);
  assert.equal(result.visible.has('item:topic'), true);
  assert.equal(result.visible.has('question:who'), true);
  assert.equal(result.visible.has('question:how'), false);
  assert.deepEqual(result.results[0].path, [
    'Launch strategy',
    'Why',
    'Reach new customers',
    'Who',
    'Operations leaders',
  ]);
});

test('recursive search visits every matching sibling branch', () => {
  const state = sampleState();
  const result = findTreeMatches(state, 're');
  assert.equal(result.matches.has('item:reasonA'), true);
  assert.equal(result.matches.has('item:reasonB'), true);
});
