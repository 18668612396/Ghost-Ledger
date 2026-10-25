import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdventure, transition, getAvailableNodes, getCardView, isValidSave } from '../../game/src/engine.js';
import { validateContent } from '../../game/src/runtime/content-schema.js';
import { renderBattlefield } from '../../game/src/battlefield-view.js';
import { renderCollectionGrid, cardCollectionKey } from '../../game/src/collection-view.js';

const payload = `夜巡"<img src=x onerror="globalThis.__viewAttack=1"> '&`;
const uid = `enemy" data-injected="yes" onpointerenter="globalThis.__viewAttack=1" <img src=x onerror="globalThis.__viewAttack=1">`;
const asset = id => `/public/assets/${id}.png?label="${payload}"&version=1`;
const decode = text => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]);

// Inspect actual start tags and their quoted attributes, rather than rejecting
// harmless event-looking words inside encoded text or a data attribute value.
function startTags(html) {
  return [...html.matchAll(/<([a-z][\w-]*)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi)].map(([, name, attrs]) => ({
    name: name.toLowerCase(),
    attributes: Object.fromEntries([...attrs.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/g)].map(([, key, quoted, single, plain]) => [key.toLowerCase(), decode(quoted ?? single ?? plain)])),
  }));
}
function assertTextOnlyPayload(html) {
  const tags = startTags(html);
  assert.ok(tags.length > 0);
  for (const tag of tags) {
    assert.ok(!['script', 'iframe', 'object', 'embed'].includes(tag.name), tag.name);
    assert.ok(!Object.keys(tag.attributes).some(name => /^on/i.test(name) || name === 'data-injected'), JSON.stringify(tag));
    if (tag.name === 'img') assert.ok(tag.attributes.src.startsWith('/public/assets/'), JSON.stringify(tag));
  }
  assert.ok(html.includes('&lt;img'), 'The supplied image markup must remain literal text');
  return tags;
}
function scenario() {
  let run = createAdventure(419);
  run = transition(run, { type: 'selectNode', nodeId: getAvailableNodes(run)[0].id });
  run.enemies = [run.enemies[0]];
  const enemy = run.enemies[0], definition = run.contentSnapshot.enemies[enemy.id];
  enemy.uid = uid; enemy.strength = 3;
  definition.name = payload;
  definition.traits ||= [];
  definition.traits.push({ id: 'html-display', label: payload, description: payload, display: [{ text: payload }] });
  run.contentSnapshot.acts[run.actId].name = payload;
  const card = run.contentSnapshot.cards[run.hand[0].cardId]; card.name = payload; card.text = payload;
  run.contentSnapshot.potions.fire.name = payload;
  run.potions = [{ uid, id: 'fire' }];
  assert.deepEqual(validateContent(run.contentSnapshot), []);
  assert.equal(isValidSave(run), true, 'This must exercise a supported imported run, not a rejected fixture');
  return run;
}

test('battlefield treats supported snapshot names, mechanism text and enemy uid as text', () => {
  const run = scenario(), before = structuredClone(run), healthCalls = [];
  const html = renderBattlefield(run, {
    asset, icon: () => '<span class="icon arrow"></span>', animationTime: 1250,
    healthMarkup(hp, maxHp) { healthCalls.push([hp, maxHp]); return `<span class="safe-health">${hp}/${maxHp}</span>`; },
  });
  const tags = assertTextOnlyPayload(html);
  assert.equal(tags.filter(tag => tag.name === 'img').length, 2);
  assert.deepEqual(tags.filter(tag => Object.hasOwn(tag.attributes, 'data-enemy-uid')).map(tag => tag.attributes['data-enemy-uid']), [uid, uid]);
  const target = tags.find(tag => tag.name === 'button');
  assert.equal(target.attributes['aria-label'], `查看：${payload}，生命 ${run.enemies[0].hp}/${run.enemies[0].maxHp}`);
  assert.equal(decode(html.match(/<strong>(.*?)<\/strong>/s)[1]), payload);
  assert.equal(decode(html.match(/<small class="enemy-mechanic">(.*?)<\/small>/s)[1]), payload);
  assert.deepEqual(healthCalls, [[run.enemies[0].hp, run.enemies[0].maxHp]]);
  assert.match(html, /--enemy-bob-duration:3600ms;--enemy-bob-delay:-1250ms/);
  assert.match(html, /<span>力3<\/span>/);
  assert.deepEqual(run, before);
});

test('collection text and every optional data attribute stay in their quoted values', () => {
  const run = scenario(), card = getCardView(run, run.hand[0]);
  const entries = [{
    action: 'collection-card', key: cardCollectionKey(card), cardId: card.id,
    name: card.name, typeLabel: payload, family: card.visual.family,
    icon: card.visual.icon, background: card.visual.background, cost: card.cost, count: 2,
  }, {
    action: 'collection-item', key: `potion:${uid}`, itemKind: 'potion', itemId: 'fire', itemUid: uid,
    name: run.contentSnapshot.potions.fire.name, typeLabel: payload, icon: 'card-art-fire', count: 1,
  }, {
    action: 'collection-enemy', key: `enemy:${run.enemies[0].id}`, enemyId: run.enemies[0].id,
    name: run.contentSnapshot.enemies[run.enemies[0].id].name, typeLabel: payload, icon: run.contentSnapshot.enemies[run.enemies[0].id].art,
  }];
  const before = structuredClone(entries), html = renderCollectionGrid(entries, { asset });
  const tags = assertTextOnlyPayload(html), buttons = tags.filter(tag => tag.name === 'button');
  assert.equal(buttons.length, entries.length);
  assert.equal(buttons[0].attributes['data-collection-key'], entries[0].key);
  assert.equal(buttons[0].attributes['data-card-id'], card.id);
  assert.equal(buttons[1].attributes['data-item-kind'], 'potion');
  assert.equal(buttons[1].attributes['data-item-id'], 'fire');
  assert.equal(buttons[1].attributes['data-item-uid'], uid);
  assert.equal(buttons[2].attributes['data-enemy-id'], run.enemies[0].id);
  assert.ok(buttons.every(button => button.attributes['aria-label'].includes(payload)));
  const names = [...html.matchAll(/<strong class="collection-tile-name">(.*?)<\/strong>/gs)].map(match => decode(match[1]));
  assert.deepEqual(names, entries.map(entry => entry.name));
  assert.match(html, /class="collection-tile-cost-number">1<\/span>/);
  assert.match(html, /class="collection-tile-count">×2<\/span>/);
  assert.deepEqual(entries, before);
});

test('collection empty copy is text and inherited object names are not allowed actions', () => {
  const html = renderCollectionGrid([], { emptyMessage: payload }); assertTextOnlyPayload(html);
  assert.equal(decode(html.match(/<p class="collection-empty">(.*?)<\/p>/s)[1]), payload);
  for (const action of ['toString', 'constructor', '__proto__']) {
    assert.throws(() => renderCollectionGrid([{ action, name: payload, icon: 'card-art-fire' }], { asset }), RangeError);
  }
});
