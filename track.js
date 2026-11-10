// 공평셈 — 이벤트 추적 레이어
// 모든 이벤트를 window.dataLayer 로 push 한다. GTM 컨테이너만 연결하면 GA4로 전송된다.
// 공통 파라미터: variant, entry_type, utm_source, utm_medium, utm_campaign, utm_content, traffic_type
//
// 테스트용 URL 파라미터
//   ?v=A | ?v=B      랜딩 버전 강제 지정 (지정 시 그 기기에 저장)
//   ?internal=1      이 기기를 내부 트래픽으로 표시 (traffic_type=internal) · ?internal=0 으로 해제
//   ?debug=1         콘솔에 이벤트 출력

const store = {
  get(kind, key) { try { return window[kind].getItem(key); } catch { return null; } },
  set(kind, key, val) { try { window[kind].setItem(key, val); } catch { /* 저장 불가 환경 */ } },
  del(kind, key) { try { window[kind].removeItem(key); } catch { /* noop */ } },
};

const K = {
  variant: 'gps_variant',
  internal: 'gps_internal',
  utm: 'gps_utm',
  entry: 'gps_entry_type',
};

let debug = false;
const fired = new Set();

export function initTracking() {
  window.dataLayer = window.dataLayer || [];
  const q = new URLSearchParams(location.search);

  debug = q.get('debug') === '1';

  if (q.get('internal') === '1') store.set('localStorage', K.internal, '1');
  if (q.get('internal') === '0') store.del('localStorage', K.internal);

  const v = (q.get('v') || '').toUpperCase();
  if (v === 'A' || v === 'B') store.set('localStorage', K.variant, v);

  // 세션 첫 유입의 UTM만 기록 (세션 중 이동으로 덮어쓰지 않음)
  if (!store.get('sessionStorage', K.utm)) {
    const utm = {};
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
      if (q.get(k)) utm[k] = q.get(k);
    }
    store.set('sessionStorage', K.utm, JSON.stringify(utm));
  }
}

export function getVariant() {
  let v = store.get('localStorage', K.variant);
  if (v !== 'A' && v !== 'B') {
    v = Math.random() < 0.5 ? 'A' : 'B';
    store.set('localStorage', K.variant, v);
  }
  return v;
}

export function setEntryType(type) {
  store.set('sessionStorage', K.entry, type);
}

function common() {
  let utm = {};
  try { utm = JSON.parse(store.get('sessionStorage', K.utm) || '{}'); } catch { /* noop */ }
  return {
    variant: getVariant(),
    entry_type: store.get('sessionStorage', K.entry) || 'direct',
    traffic_type: store.get('localStorage', K.internal) === '1' ? 'internal' : 'external',
    ...utm,
  };
}

/** 이벤트 전송 */
export function track(event, params = {}) {
  const payload = { event, ...common(), ...params };
  window.dataLayer.push(payload);
  if (debug) console.log('[track]', payload);
}

/** 한 페이지 생명주기 동안 한 번만 전송 */
export function trackOnce(event, params = {}) {
  if (fired.has(event)) return;
  fired.add(event);
  track(event, params);
}

/** 새 정산을 시작할 때 1회성 이벤트 기록 초기화 */
export function resetOnce(...events) {
  for (const e of events) fired.delete(e);
}
