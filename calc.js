// 공평셈 — 차등 정산 계산 로직 (순수 함수, DOM 의존 없음)
//
// 규칙
// - 각 항목은 "그 항목에 참여한 사람"끼리 똑같이 나눈다. (술 안 마심, 2차 불참은 참여 체크로 표현)
// - 정산자(돈을 낸 사람)를 제외한 사람은 자기 몫을 정산 단위(1·10·100원)로 버림한 금액을 보낸다.
// - 버림으로 생긴 끝전은 정산자가 부담한다. → 모든 사람 몫의 합은 항상 총액과 정확히 같다.

export const MAX_MEMBERS = 20;
export const MAX_ITEMS = 30;
export const UNITS = [1, 10, 100];

/** 입력 검증. 문제가 없으면 빈 배열, 있으면 사람이 읽을 수 있는 오류 메시지 배열 */
export function validate(state) {
  const errors = [];
  const { members = [], items = [], payer = 0, unit = 1 } = state || {};

  if (members.length < 2) errors.push('참여자를 2명 이상 입력해 주세요.');
  if (members.length > MAX_MEMBERS) errors.push(`참여자는 최대 ${MAX_MEMBERS}명까지 가능해요.`);
  if (members.some((m) => !String(m).trim())) errors.push('이름이 비어 있는 참여자가 있어요.');
  if (!(payer >= 0 && payer < members.length)) errors.push('정산자를 선택해 주세요.');
  if (!UNITS.includes(unit)) errors.push('정산 단위가 올바르지 않아요.');

  if (items.length < 1) errors.push('항목을 1개 이상 입력해 주세요.');
  if (items.length > MAX_ITEMS) errors.push(`항목은 최대 ${MAX_ITEMS}개까지 가능해요.`);
  items.forEach((it, idx) => {
    const label = it.name?.trim() || `${idx + 1}번째 항목`;
    if (!Number.isInteger(it.amount) || it.amount <= 0) {
      errors.push(`${label}: 금액은 1원 이상의 정수로 입력해 주세요.`);
    }
    const who = (it.who || []).filter((w) => w >= 0 && w < members.length);
    if (who.length === 0) errors.push(`${label}: 참여한 사람을 1명 이상 선택해 주세요.`);
  });
  return errors;
}

/** 차등 항목이 하나라도 있는지 (= 전원 참여가 아닌 항목 존재) */
export function hasExclusion(state) {
  const n = state.members.length;
  return state.items.some((it) => new Set(it.who).size < n);
}

/**
 * 정산 계산
 * @returns {{
 *   total:number,
 *   people:{ index:number, name:string, exact:number, owe:number, isPayer:boolean,
 *            items:{ name:string, share:number }[] }[],
 *   payerExtra:number
 * }}
 */
export function settle(state) {
  const errors = validate(state);
  if (errors.length) {
    const e = new Error(errors[0]);
    e.errors = errors;
    throw e;
  }
  const { members, items, payer, unit } = state;
  const total = items.reduce((s, it) => s + it.amount, 0);

  const people = members.map((name, index) => ({
    index,
    name: String(name).trim(),
    exact: 0,
    owe: 0,
    isPayer: index === payer,
    items: [],
  }));

  for (const it of items) {
    const who = [...new Set(it.who)].filter((w) => w >= 0 && w < members.length);
    const share = it.amount / who.length;
    for (const w of who) {
      people[w].exact += share;
      people[w].items.push({ name: it.name?.trim() || '항목', share });
    }
  }

  // 정산자 외: 단위 버림 (부동소수 오차 방지용 1e-9 보정)
  let othersSum = 0;
  for (const p of people) {
    if (p.isPayer) continue;
    p.owe = Math.floor(p.exact / unit + 1e-9) * unit;
    othersSum += p.owe;
  }
  // 정산자: 총액 - 나머지 합 (끝전 포함)
  const payerPerson = people[payer];
  payerPerson.owe = total - othersSum;
  const payerExtra = Math.round(payerPerson.owe - payerPerson.exact);

  return { total, people, payerExtra };
}

/** GA4 전송용 금액 구간 (실제 금액은 보내지 않음) */
export function amountRange(total) {
  if (total < 50000) return '~5만';
  if (total < 100000) return '5~10만';
  if (total < 200000) return '10~20만';
  if (total < 500000) return '20~50만';
  return '50만~';
}

export const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
