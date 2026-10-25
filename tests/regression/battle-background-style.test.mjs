import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRuntimeSource } from '../../tools/check-art.mjs';
const fade = 'linear-gradient(to bottom, rgba(8, 20, 26, .38), rgba(8, 20, 26, .16) 48%, rgba(8, 20, 26, 0))';
const rule = (selector, value = fade) => `${selector} { top: 0; height: 24%; background: ${value}; }`;
const target = '.in-combat > .world-background::before';
test('the requested neutral fade is allowed only inside the two battle background pseudo-elements', () => {
  assert.deepEqual(inspectRuntimeSource(rule(target) + rule(target.replace('before', 'after')), 'src/style.css'), []);
  assert.deepEqual(inspectRuntimeSource(rule(target, ` ${fade} `), 'src/style.css'), []);
});
test('the same gradient remains forbidden on card, monster and scene-wide foreground layers', () => {
  for (const selector of ['.card', '.enemy-art', '.in-combat', '.in-combat > .world-background::before, .card']) assert.ok(inspectRuntimeSource(rule(selector), 'src/style.css').length, selector);
});
test('background shading is not a general exemption for other files or inline styles', () => {
  assert.ok(inspectRuntimeSource(rule(target), 'src/skins.css').length);
  assert.ok(inspectRuntimeSource(`const css = '${fade}';`, 'src/main.js').length);
});
test('colorful, repeating and opaque ornamental gradients remain forbidden', () => {
  for (const value of [fade.replace('linear-gradient', 'repeating-linear-gradient'), fade.replaceAll('8, 20, 26', '255, 0, 0'), fade.replace('.38', '.9'), fade.replaceAll('rgba(8, 20, 26, 0)', 'rgba(8, 20, 26, .2)')]) assert.ok(inspectRuntimeSource(rule(target, value), 'src/style.css').length, value);
});
test('other forbidden declarations in an approved background rule are still inspected', () => {
  assert.ok(inspectRuntimeSource(rule(target).replace('top: 0;', 'box-shadow: 0 0 8px black;'), 'src/style.css').length);
  assert.ok(inspectRuntimeSource(rule(target) + '.card { background: #fff; }', 'src/style.css').length);
});
