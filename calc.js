// 공평셈 — 차등 정산 계산 로직 (순수 함수, DOM 의존 없음)
//
// 규칙
// - 장소(항목)마다 결제한 사람이 있다. 장소마다 결제자가 달라도 된다.
// - 각 장소 금액은 그 장소에 함께한 사람끼리 똑같이 나눈다. (술 안 마심, 2차 불참은 빠진 사람으로 표현)
// - 1원 단위로 계산한다. 나누어떨어지지 않는 끝전은 그 장소를 결제한 사람이 부담한다.
// - 보낼 돈은 "누가 누구에게"로 묶고, 서로 주고받을 돈이 있으면 상계해서 한 방향만 남긴다.
//   → 각자 부담한 금액의 합은 항상 총액과 정확히 같다.

export const MAX_MEMBERS = 20;
export const MAX_ITEMS = 30;

const label = (it, k) => it.name?.trim() || `${k + 1}번째 장소`;

/** 1·2단계 검증: 사람과 장소·금액 */
export function validateMembers(state) {
  const errors = [];
  const { members = [] } = state || {};
  if (members.length < 2) errors.push('함께한 사람을 2명 이상 입력해 주세요.');
  if (members.length > MAX_MEMBERS) errors.push(`함께한 사람은 최대 ${MAX_MEMBERS}명까지 가능해요.`);
  if (members.some((m) => !String(m).trim())) errors.push('이름이 비어 있는 사람이 있어요.');
  const names = members.map((m) => String(m).trim());
  if (new Set(names).size !== names.length) errors.push('같은 이름이 있어요. 구분할 수 있게 바꿔 주세요.');
  return errors;
}

export function validateItems(state) {
  const errors = [];
  const { items = [] } = state || {};
  if (items.length < 1) errors.push('장소를 1곳 이상 입력해 주세요.');
  if (items.length > MAX_ITEMS) errors.push(`장소는 최대 ${MAX_ITEMS}곳까지 가능해요.`);
  items.forEach((it, k) => {
    if (!Number.isInteger(it.amount) || it.amount <= 0) {
      errors.push(`${label(it, k)}: 결제금액을 1원 이상 입력해 주세요.`);
    }
  });
  return errors;
}

/** 3단계 검증: 결제한 사람과 함께한 사람 */
export function validatePeople(state) {
  const errors = [];
  const { members = [], items = [] } = state || {};
  items.forEach((it, k) => {
    if (!(Number.isInteger(it.payer) && it.payer >= 0 && it.payer < members.length)) {
      errors.push(`${label(it, k)}: 결제한 사람을 골라 주세요.`);
    }
    const who = (it.who || []).filter((w) => w >= 0 && w < members.length);
    if (who.length === 0) errors.push(`${label(it, k)}: 함께한 사람이 최소 1명은 있어야 해요.`);
  });
  return errors;
}

export function validate(state) {
  return [...validateMembers(state), ...validateItems(state), ...validatePeople(state)];
}

/** 빠진 사람이 있는 장소가 하나라도 있는지 */
export function hasExclusion(state) {
  const n = state.members.length;
  return state.items.some((it) => new Set(it.who).size < n);
}

/**
 * 정산 계산
 * @returns {{
 *   total: number,
 *   people: { index, name, cost, paid, extra, missed: string[], items: {name, share}[] }[],
 *   transfers: { from, to, amount, items: {name, share}[], offsets: {name, share}[] }[]
 * }}
 *   cost  = 내가 부담한 금액 (끝전 포함), paid = 내가 결제한 금액, extra = 내가 부담한 끝전
 */
export function settle(state) {
  const errors = validate(state);
  if (errors.length) {
    const e = new Error(errors[0]);
    e.errors = errors;
    throw e;
  }
  const { members, items } = state;
  const n = members.length;
  const total = items.reduce((s, it) => s + it.amount, 0);

  const people = members.map((name, index) => ({
    index, name: String(name).trim(), cost: 0, paid: 0, extra: 0, missed: [], items: [],
  }));

  // owe[d][c] = d가 c에게 보낼 금액(상계 전), 그 근거 장소들
  const owe = Array.from({ length: n }, () => Array(n).fill(0));
  const why = Array.from({ length: n }, () => Array.from({ length: n }, () => []));

  items.forEach((it, k) => {
    const name = label(it, k);
    const who = [...new Set(it.who)].filter((w) => w >= 0 && w < n).sort((a, b) => a - b);
    const base = Math.floor(it.amount / who.length);
    const rest = it.amount - base * who.length; // 끝전 → 결제자 부담
    people[it.payer].paid += it.amount;

    for (const p of people) if (!who.includes(p.index)) p.missed.push(name);

    for (const w of who) {
      people[w].cost += base;
      people[w].items.push({ name, share: base });
      if (w !== it.payer) {
        owe[w][it.payer] += base;
        why[w][it.payer].push({ name, share: base });
      }
    }
    if (rest > 0) {
      people[it.payer].cost += rest;
      people[it.payer].extra += rest;
    }
  });

  // 쌍방 상계
  const transfers = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const net = owe[a][b] - owe[b][a];
      if (net === 0) continue;
      const [from, to] = net > 0 ? [a, b] : [b, a];
      transfers.push({
        from, to, amount: Math.abs(net),
        items: why[from][to],
        offsets: why[to][from],
      });
    }
  }
  transfers.sort((x, y) => x.to - y.to || y.amount - x.amount || x.from - y.from);

  return { total, people, transfers };
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

/** "미영" → "미영이가", "민수" → "민수가" (받침 유무), 한글이 아니면 "Tom(이)가" */
export function iga(name) {
  const s = String(name).trim();
  const last = s.charCodeAt(s.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) return (last - 0xac00) % 28 ? `${s}이가` : `${s}가`;
  return `${s}(이)가`;
}
