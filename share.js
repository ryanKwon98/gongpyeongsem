// 공평셈 — 정산 내역 ↔ 공유 링크 변환
// 서버 없이 정산 내역 전체를 URL의 # 뒤에 압축해 담는다.
// (# 뒤 값은 서버·GA4 page_location으로 전송되지 않아 개인정보 노출이 적다)

const LZ = () => {
  const lz = globalThis.LZString;
  if (!lz) throw new Error('LZString이 로드되지 않았어요.');
  return lz;
};

const VERSION = 1;

/** 짧은 공유 ID (원 공유와 수신자 행동을 연결하는 용도) */
export function newShareId() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id = '';
  const rand = globalThis.crypto?.getRandomValues
    ? globalThis.crypto.getRandomValues(new Uint8Array(8))
    : Array.from({ length: 8 }, () => Math.floor(Math.random() * 256));
  for (const b of rand) id += chars[b % chars.length];
  return id;
}

const toMask = (who) => who.reduce((m, w) => m | (1 << w), 0);
const fromMask = (mask, n) => Array.from({ length: n }, (_, i) => i).filter((i) => mask & (1 << i));

/** state → URL-safe 문자열 */
export function encodeState(state, shareId) {
  const compact = {
    v: VERSION,
    t: state.title || '',
    m: state.members,
    p: state.payer,
    u: state.unit,
    i: state.items.map((it) => [it.name || '', it.amount, toMask(it.who)]),
    s: shareId,
  };
  return LZ().compressToEncodedURIComponent(JSON.stringify(compact));
}

/** URL-safe 문자열 → { state, shareId } (형식이 깨졌으면 null) */
export function decodeState(encoded) {
  try {
    const json = LZ().decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const c = JSON.parse(json);
    if (c.v !== VERSION || !Array.isArray(c.m) || !Array.isArray(c.i)) return null;
    const n = c.m.length;
    return {
      shareId: typeof c.s === 'string' ? c.s : '',
      state: {
        title: typeof c.t === 'string' ? c.t : '',
        members: c.m.map(String),
        payer: Number(c.p) || 0,
        unit: Number(c.u) || 1,
        items: c.i.map(([name, amount, mask]) => ({
          name: String(name ?? ''),
          amount: Number(amount),
          who: fromMask(Number(mask) || 0, n),
        })),
      },
    };
  } catch {
    return null;
  }
}

/** 공유 링크 전체 URL */
export function buildShareUrl(state, shareId, base) {
  const origin = base ?? `${location.origin}${location.pathname}`;
  return `${origin}#s=${encodeState(state, shareId)}`;
}

/** 현재 주소의 # 에서 공유 데이터 읽기 */
export function readShareHash(hash) {
  const m = /[#&]s=([^&]+)/.exec(hash || '');
  return m ? decodeState(m[1]) : null;
}
