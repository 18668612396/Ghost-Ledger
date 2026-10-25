import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAdventure, getCardView, isValidSave, restoreRun } from '../../game/src/engine.js';
import { cardView } from '../../game/src/runtime/effects.js';
import { getCardArtLayout } from '../../game/src/card-art-layout.js';
import { getCardVisual } from '../../game/src/card-visuals.js';
import { renderCollectionGrid } from '../../game/src/collection-view.js';

const original = JSON.parse(await readFile(new URL('../fixtures/card-art-before-unique.json', import.meta.url), 'utf8'));
function existingRun() {
  const run = createAdventure(294, { runId: 'current-format-before-artwork-update' });
  run.contentSnapshot.cards = Object.fromEntries(original.map(card => [card.id, structuredClone(card)]));
  return restoreRun(run);
}

test('all 101 cards in an existing current-format run display distinct current artwork', () => {
  const run = existingRun();
  assert.ok(isValidSave(run));
  const before = structuredClone(run), icons = new Set();
  for (const card of original) {
    const view = getCardView(run, card.id);
    assert.equal(view.visual.icon, card.visual.icon, 'Rules view must retain its authored snapshot');
    const visual = getCardVisual(view, { latestArtwork: true });
    assert.equal(visual.icon, `card-art-unique-${card.id}`);
    icons.add(visual.icon);
    assert.ok(Number.isFinite(getCardArtLayout(visual).offsetX));
  }
  assert.equal(icons.size, 101);
  assert.deepEqual(run, before, 'Display reads must not rewrite snapshot, progress, RNG, or cards');
});

test('the reported reward cards resolve to separate art and collection URLs', () => {
  const run = existingRun();
  const ids = ['ic_shockwave', 'ic_rupture', 'ic_heavy_blade'];
  const entries = ids.map(id => {
    const card = getCardView(run, id), visual = getCardVisual(card, { latestArtwork: true });
    return { key: id, cardId: id, action: 'collection-card', name: card.name, family: visual.family, icon: visual.icon, background: visual.background, cost: card.cost };
  });
  const html = renderCollectionGrid(entries, { asset: id => `/public/assets/${id}.png` });
  for (const id of ids) assert.ok(html.includes(`/public/assets/card-art-unique-${id}.png`));
  assert.ok(!html.includes('/public/assets/card-art-brush.png'));
  assert.equal(new Set(entries.map(entry => entry.icon)).size, 3);
});

test('current artwork keeps snapshot costs, effects, upgrades, family, backgrounds and impact', () => {
  const run = existingRun(), card = run.contentSnapshot.cards.ic_heavy_blade;
  card.cost = 0;
  card.effects[0].amount = 37;
  card.visual.family = 'oath'; card.visual.background = 'card-pattern-color-vow'; card.visual.impact = 'curse';
  card.upgrade = { cost: 1, text: '测试快照：造成41点伤害。', effects: [{ op: 'damage', target: 'enemy', amount: 41 }] };
  const before = structuredClone(run);
  const base = getCardView(run, 'ic_heavy_blade');
  const upgrade = getCardView(run, { uid: 'held-upgrade', cardId: 'ic_heavy_blade', upgradeLevel: 1 });
  assert.equal(base.cost, 0); assert.equal(base.effects[0].amount, 37);
  assert.equal(upgrade.cost, 1); assert.equal(upgrade.effects[0].amount, 41); assert.match(upgrade.description, /41/);
  for (const view of [base, upgrade]) {
    const visual = getCardVisual(view, { latestArtwork: true });
    assert.equal(visual.icon, 'card-art-unique-ic_heavy_blade');
    for (const field of ['family', 'background', 'cost', 'impact']) assert.equal(visual[field], card.visual[field]);
  }
  assert.deepEqual(run, before);
});

test('authored same-id drafts keep their chosen visual and unknown snapshot cards retain their own art', () => {
  const run = existingRun();
  const authored = run.contentSnapshot.cards.ic_rupture;
  authored.visual.icon = 'card-art-mirror';
  const draftView = cardView(run, 'ic_rupture', run.contentSnapshot);
  assert.equal(getCardVisual(draftView).icon, 'card-art-mirror');
  assert.equal(draftView.visual.icon, 'card-art-mirror');
  const custom = { ...structuredClone(authored), id: 'snapshot_only_card', visual: { ...authored.visual, family: 'ward' } };
  run.contentSnapshot.cards[custom.id] = custom;
  const customView = getCardView(run, custom.id);
  const visual = getCardVisual(customView, { latestArtwork: true });
  assert.equal(visual.icon, 'card-art-mirror'); assert.equal(visual.frame, 'card-frame-vivid-ward');
});
