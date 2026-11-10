// 공평셈 계산·공유 로직 테스트 (PRD P0 산출물: 테스트 케이스 10개)
// 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { settle, validate, hasExclusion, amountRange } from '../js/calc.js';

const require = createRequire(import.meta.url);
globalThis.LZString = require('lz-string');
const { encodeState, decodeState, buildShareUrl, readShareHash } = await import('../js/share.js');

const all = (n) => Array.from({ length: n }, (_, i) => i);
const owes = (r) => r.people.map((p) => p.owe);
const sum = (a) => a.reduce((s, x) => s + x, 0);

test('1. 단순 1/N: 3명이 30,000원을 나누면 각 10,000원', () => {
  const r = settle({ members: ['나', '민수', '지영'], payer: 0, unit: 1,
    items: [{ name: '저녁', amount: 30000, who: all(3) }] });
  assert.deepEqual(owes(r), [10000, 10000, 10000]);
  assert.equal(r.payerExtra, 0);
});

test('2. 나누어떨어지지 않으면 끝전은 정산자가 부담', () => {
  const r = settle({ members: ['나', '민수', '지영'], payer: 0, unit: 1,
    items: [{ name: '커피', amount: 10000, who: all(3) }] });
  assert.deepEqual(owes(r), [3334, 3333, 3333]);
  assert.equal(r.payerExtra, 1);
});

test('3. 술 안 마신 사람은 주류 항목에서 빠진다', () => {
  // 식사 60,000원 4명, 소주 21,000원은 지영(2) 제외 3명
  const r = settle({ members: ['나', '민수', '지영', '현우'], payer: 0, unit: 1,
    items: [
      { name: '식사', amount: 60000, who: all(4) },
      { name: '소주', amount: 21000, who: [0, 1, 3] },
    ] });
  assert.deepEqual(owes(r), [22000, 22000, 15000, 22000]);
  assert.equal(sum(owes(r)), 81000);
});

test('4. 2차 불참자는 2차 금액을 내지 않는다', () => {
  const r = settle({ members: ['나', '민수', '지영', '현우'], payer: 1, unit: 1,
    items: [
      { name: '1차', amount: 40000, who: all(4) },
      { name: '2차', amount: 30000, who: [1, 3] },
    ] });
  assert.deepEqual(owes(r), [10000, 25000, 10000, 25000]);
});

test('5. 100원 단위 버림: 받는 쪽(정산자)이 끝전을 부담하고 합계는 정확히 일치', () => {
  const r = settle({ members: ['나', '민수', '지영'], payer: 0, unit: 100,
    items: [{ name: '고기', amount: 77777, who: all(3) }] });
  // 1인 25,925.67원 → 다른 사람은 25,900원, 정산자는 77,777 - 51,800 = 25,977원
  assert.deepEqual(owes(r), [25977, 25900, 25900]);
  assert.equal(sum(owes(r)), 77777);
  assert.equal(r.payerExtra, 51);
});

test('6. 정산자가 어떤 항목에 빠져도 다른 사람 몫은 정확하다', () => {
  const r = settle({ members: ['나', '민수', '지영'], payer: 0, unit: 10,
    items: [
      { name: '식사', amount: 45000, who: all(3) },
      { name: '와인', amount: 25000, who: [1, 2] },
    ] });
  assert.deepEqual(owes(r), [15000, 27500, 27500]);
});

test('7. 무작위 300건: 모든 사람 몫의 합은 항상 총액과 같고, 누구도 음수가 아니다', () => {
  let seed = 42;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let k = 0; k < 300; k++) {
    const n = 2 + rnd(12);
    const items = Array.from({ length: 1 + rnd(8) }, () => {
      const who = all(n).filter(() => rnd(3) > 0);
      return { name: 'x', amount: 1 + rnd(300000), who: who.length ? who : [rnd(n)] };
    });
    const state = { members: all(n).map((i) => `p${i}`), payer: rnd(n), unit: [1, 10, 100][rnd(3)], items };
    const r = settle(state);
    assert.equal(sum(owes(r)), r.total, `case ${k}`);
    for (const p of r.people) {
      assert.ok(p.owe >= 0, `case ${k}: 음수`);
      if (!p.isPayer) assert.ok(p.exact - p.owe < state.unit + 1e-6, `case ${k}: 버림 폭 초과`);
    }
  }
});

test('8. 참여자가 아무도 없는 항목은 오류', () => {
  const errs = validate({ members: ['나', '민수'], payer: 0, unit: 1,
    items: [{ name: '디저트', amount: 8000, who: [] }] });
  assert.ok(errs.some((e) => e.includes('디저트')));
  assert.throws(() => settle({ members: ['나', '민수'], payer: 0, unit: 1,
    items: [{ name: '디저트', amount: 8000, who: [] }] }));
});

test('9. 금액이 0·음수·소수이거나 참여자가 1명이면 오류', () => {
  const base = { members: ['나', '민수'], payer: 0, unit: 1 };
  for (const amount of [0, -1000, 1234.5, NaN]) {
    assert.ok(validate({ ...base, items: [{ name: 'a', amount, who: [0, 1] }] }).length > 0, `amount=${amount}`);
  }
  assert.ok(validate({ ...base, members: ['나'], items: [{ name: 'a', amount: 1000, who: [0] }] }).length > 0);
});

test('10. 공유 링크 왕복: 10명·15항목도 원본과 같고 URL은 2,000자 이내', () => {
  const state = {
    title: '팀 회식',
    members: ['나', '민수', '지영', '현우', '서연', '도윤', '하은', '지호', '수아', '예준'],
    payer: 3, unit: 10,
    items: Array.from({ length: 15 }, (_, i) => ({
      name: `항목 ${i + 1} 삼겹살·소주`, amount: 10000 + i * 1370, who: all(10).filter((x) => (x + i) % 3 !== 0),
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

test('보조: 차등 여부와 금액 구간', () => {
  assert.equal(hasExclusion({ members: ['a', 'b'], items: [{ amount: 1, who: [0, 1] }] }), false);
  assert.equal(hasExclusion({ members: ['a', 'b'], items: [{ amount: 1, who: [0] }] }), true);
  assert.equal(amountRange(30000), '~5만');
  assert.equal(amountRange(150000), '10~20만');
});
