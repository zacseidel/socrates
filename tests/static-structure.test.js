import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('all statically queried element IDs exist exactly once', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('app.js', root), 'utf8'),
  ]);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const queriedIds = [...script.matchAll(/getElementById\('([^']+)'\)/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  queriedIds.forEach(id => assert.equal(ids.includes(id), true, `Missing #${id}`));
});

test('Focus, ordering, module loading, and phone breakpoint are present', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('style.css', root), 'utf8'),
  ]);
  assert.match(html, /id="focusView"/);
  assert.match(html, /id="orderSheet"/);
  assert.match(html, /<script type="module" src="app\.js">/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /height: 100dvh/);
  assert.match(css, /touch-action: none/);
});
