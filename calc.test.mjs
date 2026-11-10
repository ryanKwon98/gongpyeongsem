// 공평셈 계산·공유 로직 테스트 (PRD P0 산출물: 테스트 케이스 10개)
// 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { settle, validate, validateMembers, validateItems, validatePeople, hasExclusion, amountRange, iga } from './calc.js';

const require = createRequire(import.meta.url);
globalThis.LZString = require('lz-string');
const { encodeState, decodeState, buildShareUrl, readShareHash } = await import('./share.js');

const all = (n) => Array.from({ length: n }, (_, i) => i);
const sum = (a) => a.reduce((s, x) => s + x, 0);
const flows = (r) => r.transfers.map((t) => [t.from, t.to, t.amount]);
const M4 = ['민수', '미영', '지영', '현우'];

test('1. 단순 1/N: 3명이 30,000원, 민수 결제 → 두 사람이 민수에게 10,000원씩', () => {
  const r = settle({ members: ['민수', '미영', '지영'],
    items: [{ name: '저녁', amount: 30000, who: all(3), payer: 0 }] });
  assert.deepEqual(flows(r), [[1, 0, 10000], [2, 0, 10000]]);
  assert.deepEqual(r.people.map((p) => p.cost), [10000, 10000, 10000]);
});

test('2. 1원 단위: 나누어떨어지지 않는 끝전은 결제자가 부담', () => {
  const r = settle({ members: ['민수', '미영', '지영'],
    items: [{ name: '커피', amount: 10000, who: all(3), payer: 0 }] });
  assert.deepEqual(flows(r), [[1, 0, 3333], [2, 0, 3333]]);
  assert.equal(r.people[0].cost, 3334);
  assert.equal(r.people[0].extra, 1);
});

test('3. 술 안 마신 사람은 그 장소 금액을 내지 않는다', () => {
  const r = settle({ members: M4, items: [
    { name: '식사', amount: 60000, who: all(4), payer: 0 },
    { name: '소주', amount: 21000, who: [0, 1, 3], payer: 0 },
  ] });
  assert.deepEqual(flows(r), [[1, 0, 22000], [3, 0, 22000], [2, 0, 15000]]);
  assert.deepEqual(r.people[2].missed, ['소주']);
});

test('4. 장소마다 결제자가 다르면 받는 사람이 여러 명이 된다', () => {
  // 1차 40,000원 민수 결제(4명), 2차 30,000원 미영 결제(미영·현우)
  const r = settle({ members: M4, items: [
    { name: '1차', amount: 40000, who: all(4), payer: 0 },
    { name: '2차', amount: 30000, who: [1, 3], payer: 1 },
  ] });
  assert.deepEqual(flows(r), [[1, 0, 10000], [2, 0, 10000], [3, 0, 10000], [3, 1, 15000]]);
  assert.deepEqual(r.people.map((p) => p.cost), [10000, 25000, 10000, 25000]);
});

test('5. 서로 줄 돈이 있으면 상계해서 한 방향만 남긴다', () => {
  // 1차 30,000원 민수 결제, 2차 12,000원 미영 결제 (모두 3명)
  const r = settle({ members: ['민수', '미영', '지영'], items: [
    { name: '1차', amount: 30000, who: all(3), payer: 0 },
    { name: '2차', amount: 12000, who: all(3), payer: 1 },
  ] });
  assert.deepEqual(flows(r), [[2, 0, 10000], [1, 0, 6000], [2, 1, 4000]]);
  const t = r.transfers.find((x) => x.from === 1 && x.to === 0);
  assert.deepEqual(t.items, [{ name: '1차', share: 10000 }]);
  assert.deepEqual(t.offsets, [{ name: '2차', share: 4000 }]);
});

test('6. 결제자가 그 장소에 빠져 있어도 정확하다 (끝전은 결제자 부담)', () => {
  const r = settle({ members: ['민수', '미영', '지영'], items: [
    { name: '와인', amount: 25001, who: [1, 2], payer: 0 },
  ] });
  assert.deepEqual(flows(r), [[1, 0, 12500], [2, 0, 12500]]);
  assert.equal(r.people[0].cost, 1);
  assert.equal(sum(r.people.map((p) => p.cost)), 25001);
});

test('7. 무작위 300건: 부담 합계 = 총액, 각자 (결제 − 부담) = (받을 돈 − 보낼 돈)', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let k = 0; k < 300; k++) {
    const n = 2 + rnd(10);
    const items = Array.from({ length: 1 + rnd(6) }, () => {
      const who = all(n).filter(() => rnd(3) > 0);
      return { name: 'x', amount: 1 + rnd(300000), who: who.length ? who : [rnd(n)], payer: rnd(n) };
    });
    const r = settle({ members: all(n).map((i) => `p${i}`), items });
    assert.equal(sum(r.people.map((p) => p.cost)), r.total, `case ${k}: 합계`);
    for (const p of r.people) {
      const recv = sum(r.transfers.filter((t) => t.to === p.index).map((t) => t.amount));
      const sent = sum(r.transfers.filter((t) => t.from === p.index).map((t) => t.amount));
      assert.equal(p.paid - p.cost, recv - sent, `case ${k}: ${p.name} 잔액`);
    }
    for (const t of r.transfers) {
      assert.ok(t.amount > 0 && t.from !== t.to, `case ${k}: 송금`);
      assert.ok(!r.transfers.some((u) => u.from === t.to && u.to === t.from), `case ${k}: 양방향`);
    }
  }
});

test('8. 단계별 검증: 사람·장소·결제자', () => {
  assert.ok(validateMembers({ members: ['민수'] }).length > 0);
  assert.ok(validateMembers({ members: ['민수', '민수'] }).some((e) => e.includes('같은 이름')));
  assert.deepEqual(validateMembers({ members: ['민수', '미영'] }), []);
  assert.ok(validatePeople({ members: ['민수', '미영'], items: [{ name: '1차', amount: 1000, who: [0, 1], payer: null }] })
    .some((e) => e.includes('결제한 사람')));
  assert.ok(validatePeople({ members: ['민수', '미영'], items: [{ name: '디저트', amount: 1000, who: [], payer: 0 }] })
    .some((e) => e.includes('디저트')));
});

test('9. 결제금액이 0·음수·소수면 오류, settle도 거부', () => {
  for (const amount of [0, -1000, 1234.5, NaN]) {
    assert.ok(validateItems({ items: [{ name: 'a', amount }] }).length > 0, `amount=${amount}`);
  }
  assert.throws(() => settle({ members: ['민수', '미영'], items: [{ name: 'a', amount: 0, who: [0, 1], payer: 0 }] }));
  assert.equal(validate({ members: ['민수', '미영'], items: [{ name: 'a', amount: 5000, who: [0, 1], payer: 1 }] }).length, 0);
});

test('10. 공유 링크 왕복: 10명·15곳·결제자 여러 명도 원본과 같고 URL은 2,000자 이내', () => {
  const state = {
    members: ['민수', '미영', '지영', '현우', '서연', '도윤', '하은', '지호', '수아', '예준'],
    items: Array.from({ length: 15 }, (_, i) => ({
      name: `${i + 1}차 삼겹살·소주`, amount: 10000 + i * 1370,
      who: all(10).filter((x) => (x + i) % 3 !== 0), payer: i % 4,
    })),
  };
  const encoded = encodeState(state, 'abc12345');
  assert.match(encoded, /^[A-Za-z0-9+\-$]+$/);
  const back = decodeState(encoded);
  assert.equal(back.shareId, 'abc12345');
  assert.deepEqual(back.state, state);
  const url = buildShareUrl(state, 'abc12345', 'https://gongpyeongsem.vercel.app/');
  assert.ok(url.length < 2000, `url length ${url.length}`);
  assert.deepEqual(readShareHash(new URL(url).hash).state, state);
  assert.equal(decodeState('깨진값'), null);
});

test('보조: 차등 여부, 금액 구간, 조사', () => {
  assert.equal(hasExclusion({ members: ['a', 'b'], items: [{ amount: 1, who: [0, 1] }] }), false);
  assert.equal(hasExclusion({ members: ['a', 'b'], items: [{ amount: 1, who: [0] }] }), true);
  assert.equal(amountRange(150000), '10~20만');
  assert.equal(iga('미영'), '미영이가');
  assert.equal(iga('민수'), '민수가');
  assert.equal(iga('Tom'), 'Tom(이)가');
});
