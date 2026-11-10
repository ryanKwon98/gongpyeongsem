// 공평셈 — 화면과 상호작용
import { settle, validate, hasExclusion, amountRange, won, UNITS, MAX_MEMBERS, MAX_ITEMS } from './calc.js';
import { newShareId, buildShareUrl, readShareHash } from './share.js';
import { initTracking, getVariant, setEntryType, track, trackOnce, resetOnce } from './track.js';

const root = document.getElementById('app');
const DRAFT_KEY = 'gps_draft';

/* ---------- 상태 ---------- */

const freshState = () => ({
  title: '',
  members: ['나'],
  payer: 0,
  unit: 10,
  items: [{ name: '', amount: 0, who: [0] }],
});

let state = loadDraft() || freshState();
let view = 'landing'; // landing | calc | result | shared
let shared = null; // { state, shareId } — 공유 링크로 들어온 경우
let errors = [];
let started = false;

function loadDraft() {
  try {
    const s = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (s && Array.isArray(s.members) && Array.isArray(s.items)) return s;
  } catch { /* noop */ }
  return null;
}
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch { /* noop */ }
}

/* ---------- 유틸 ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = (s) => Number(String(s).replace(/[^\d]/g, '')) || 0;
const fmt = (n) => (n ? n.toLocaleString('ko-KR') : '');
const total = () => state.items.reduce((s, it) => s + (it.amount || 0), 0);

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}

function markStarted(position) {
  if (started) return;
  started = true;
  trackOnce('calc_start', { cta_position: position });
}

/* ---------- 렌더 ---------- */

function render() {
  const focusKey = document.activeElement?.dataset?.key;
  const caret = document.activeElement?.selectionStart;

  root.innerHTML = {
    landing: viewLanding,
    calc: viewCalc,
    result: viewResult,
    shared: viewShared,
  }[view]();

  if (focusKey) {
    const el = root.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
    if (el) {
      el.focus();
      if (caret != null && el.setSelectionRange && el.type === 'text') {
        try { el.setSelectionRange(caret, caret); } catch { /* noop */ }
      }
    }
  }
}

const brand = () => `
  <header class="bar">
    <button class="brand" data-action="home" aria-label="공평셈 처음으로">공평셈</button>
  </header>`;

/* 랜딩 A: 설명형 */
function viewLanding() {
  return `
  ${brand()}
  <main class="landing">
    <h1 class="hero-title">1/N 말고,<br>먹은 만큼.</h1>
    <p class="hero-sub">술 안 마신 사람, 2차에 빠진 사람까지 반영해서 나누고 링크 하나로 보내요.</p>

    <figure class="receipt receipt--demo" aria-label="예시: 4명이 81,000원을 나눈 결과">
      <div class="receipt-head">
        <span>금요일 팀 회식</span><span>4명 · 81,000원</span>
      </div>
      <ul class="lines">
        <li><span>민수</span><b>22,000원</b></li>
        <li><span>현우</span><b>22,000원</b></li>
        <li class="is-diff">
          <span>지영 <em>소주 안 마심</em></span>
          <b><s>20,250원</s> 15,000원</b>
        </li>
      </ul>
      <figcaption class="receipt-foot">똑같이 나눴다면 지영은 5,250원을 더 냈어요</figcaption>
    </figure>

    <button class="btn btn--primary btn--wide" data-action="start" data-pos="hero">정산 시작하기</button>
    <p class="fine">가입 없이, 30초면 끝나요.</p>
  </main>`;
}

/* 계산기 (랜딩 B는 이 화면에서 바로 시작) */
function viewCalc() {
  const n = state.members.length;
  const memberChips = state.members.map((m, i) => `
    <li class="chip chip--member">
      <input class="chip-input" style="--len:${Math.max(m.length, 1)}" data-key="member-${i}" data-field="member" data-i="${i}" value="${esc(m)}" aria-label="${i + 1}번째 참여자 이름" maxlength="10">
      ${n > 1 ? `<button class="chip-x" data-action="remove-member" data-i="${i}" aria-label="${esc(m)} 빼기">×</button>` : ''}
    </li>`).join('');

  const payerChips = state.members.map((m, i) => `
    <button class="seg ${state.payer === i ? 'on' : ''}" data-action="payer" data-i="${i}" aria-pressed="${state.payer === i}" data-key="payer-${i}">${esc(m || `${i + 1}번`)}</button>`).join('');

  const items = state.items.map((it, k) => {
    const out = state.members.map((_, i) => i).filter((i) => !it.who.includes(i));
    return `
    <li class="item">
      <div class="item-row">
        <input class="field field--name" data-key="item-name-${k}" data-field="item-name" data-k="${k}" value="${esc(it.name)}" placeholder="${['1차 삼겹살', '소주·맥주', '2차 노래방', '디저트'][k % 4]}" aria-label="${k + 1}번째 항목 이름" maxlength="20">
        <label class="field field--amount">
          <input data-key="item-amt-${k}" data-field="item-amount" data-k="${k}" value="${fmt(it.amount)}" inputmode="numeric" placeholder="0" aria-label="${k + 1}번째 항목 금액">
          <span>원</span>
        </label>
        ${state.items.length > 1 ? `<button class="icon-x" data-action="remove-item" data-k="${k}" aria-label="${k + 1}번째 항목 삭제">×</button>` : ''}
      </div>
      <div class="who" role="group" aria-label="이 항목을 함께한 사람">
        ${state.members.map((m, i) => `
          <button class="who-chip ${it.who.includes(i) ? 'on' : ''}" data-action="toggle-who" data-k="${k}" data-i="${i}" aria-pressed="${it.who.includes(i)}" data-key="who-${k}-${i}">${esc(m || `${i + 1}번`)}</button>`).join('')}
      </div>
      ${out.length ? `<p class="item-note">${out.map((i) => esc(state.members[i] || `${i + 1}번`)).join(', ')} 빠짐</p>` : ''}
    </li>`;
  }).join('');

  const variantB = getVariant() === 'B';

  return `
  ${brand()}
  <main class="calc">
    ${variantB ? `<h1 class="calc-title">먹은 만큼 나누기</h1><p class="calc-sub">술 안 마신 사람, 2차 불참자까지 반영해요.</p>` : ''}

    <section class="step" aria-labelledby="s1">
      <h2 id="s1"><span class="step-no">1</span>누가 함께했나요?</h2>
      <p class="hint">'나' 대신 내 이름을 쓰면 받는 사람이 알아보기 쉬워요.</p>
      <ul class="chips">${memberChips}</ul>
      ${n < MAX_MEMBERS ? `
      <form class="add-row" data-action="add-member">
        <input class="field" data-key="new-member" name="name" placeholder="이름" maxlength="10" autocomplete="off" aria-label="추가할 참여자 이름">
        <button class="btn btn--ghost" type="submit">추가</button>
      </form>` : ''}
      <p class="label">누가 결제했나요?</p>
      <div class="segs">${payerChips}</div>
    </section>

    <section class="step" aria-labelledby="s2">
      <h2 id="s2"><span class="step-no">2</span>무엇을 먹었나요?</h2>
      <p class="hint">빠진 사람은 이름을 눌러 끄면 그 항목에서 제외돼요.</p>
      <ul class="items">${items}</ul>
      ${state.items.length < MAX_ITEMS ? `<button class="btn btn--ghost btn--wide" data-action="add-item">항목 추가</button>` : ''}
    </section>

    <section class="step" aria-labelledby="s3">
      <h2 id="s3"><span class="step-no">3</span>어떻게 나눌까요?</h2>
      <p class="label">정산 단위</p>
      <div class="segs">
        ${UNITS.map((u) => `<button class="seg ${state.unit === u ? 'on' : ''}" data-action="unit" data-u="${u}" aria-pressed="${state.unit === u}" data-key="unit-${u}">${u}원 단위</button>`).join('')}
      </div>
      <p class="hint">남는 끝전은 결제한 사람이 부담해요.</p>
      <label class="label" for="title">모임 이름 <span class="opt">(선택)</span></label>
      <input id="title" class="field" data-key="title" data-field="title" value="${esc(state.title)}" placeholder="금요일 팀 회식" maxlength="20">
    </section>

    ${errors.length ? `<div class="errors" role="alert">${errors.map((e) => `<p>${esc(e)}</p>`).join('')}</div>` : ''}
  </main>

  <div class="dock">
    <div class="dock-total"><span>총액</span><b data-total>${won(total())}</b></div>
    <button class="btn btn--primary" data-action="settle">정산하기</button>
  </div>`;
}

function receipt(s, r, { demoFoot } = {}) {
  const payer = r.people.find((p) => p.isPayer);
  const missed = (i) => s.items
    .filter((it) => !it.who.includes(i))
    .map((it, k) => esc(it.name?.trim() || `항목 ${k + 1}`));
  const tag = (i) => (missed(i).length ? `<em class="out">${missed(i).join(', ')} 빠짐</em>` : '');
  const to = payer.name === '나' ? '결제한 사람에게 보낼 금액' : `<b>${esc(payer.name)}</b>님에게 보낼 금액`;
  const lines = r.people
    .filter((p) => !p.isPayer)
    .map((p) => `
      <li>
        <span>${esc(p.name)}${tag(p.index)}</span><b>${won(p.owe)}</b>
        <small>${p.items.map((x) => `${esc(x.name)} ${won(x.share)}`).join(' · ')}</small>
      </li>`).join('');

  return `
  <article class="receipt" aria-label="정산 영수증">
    <div class="receipt-head">
      <span>${esc(s.title || '모임 정산')}</span><span>${s.members.length}명</span>
    </div>
    <p class="receipt-to">${to}</p>
    <ul class="lines">${lines}</ul>
    <div class="receipt-payer">
      <span>${esc(payer.name)} <em>결제</em></span><b>${won(payer.owe)}</b>
      <small>${payer.items.map((x) => `${esc(x.name)} ${won(x.share)}`).join(' · ') || '참여 항목 없음'}${r.payerExtra > 0 ? ` · 끝전 ${won(r.payerExtra)} 부담` : ''}</small>
    </div>
    <div class="receipt-total"><span>총액</span><b>${won(r.total)}</b></div>
    <p class="receipt-foot">${demoFoot || `${s.unit}원 단위 · 항목에 빠진 사람은 그 금액을 내지 않아요`}</p>
  </article>`;
}

function viewResult() {
  const r = settle(state);
  const canShare = typeof navigator.share === 'function';
  return `
  ${brand()}
  <main class="result">
    <h1 class="result-title">정산이 끝났어요</h1>
    ${receipt(state, r)}
    <div class="actions">
      ${canShare ? `<button class="btn btn--primary btn--wide" data-action="share" data-method="web_share">단톡방에 보내기</button>` : ''}
      <button class="btn ${canShare ? 'btn--ghost' : 'btn--primary'} btn--wide" data-action="share" data-method="copy">링크 복사</button>
      <button class="btn btn--text" data-action="edit">내역 수정하기</button>
    </div>
  </main>`;
}

function viewShared() {
  if (!shared) {
    return `${brand()}<main class="result"><h1 class="result-title">링크를 열 수 없어요</h1>
      <p class="hint">링크가 중간에 잘렸을 수 있어요. 보낸 사람에게 링크를 다시 받아 주세요.</p>
      <button class="btn btn--primary btn--wide" data-action="new-from-shared">새 정산 만들기</button></main>`;
  }
  let r;
  try { r = settle(shared.state); } catch {
    shared = null;
    return viewShared();
  }
  return `
  ${brand()}
  <main class="result">
    <h1 class="result-title">정산 결과가 도착했어요</h1>
    ${receipt(shared.state, r)}
    <div class="actions">
      <button class="btn btn--primary btn--wide" data-action="new-from-shared">나도 정산 만들기</button>
      <p class="fine">공평셈은 먹은 만큼 나누는 정산 계산기예요.</p>
    </div>
  </main>`;
}

/* ---------- 동작 ---------- */

function goCalc(position) {
  view = 'calc';
  markStarted(position);
  render();
  window.scrollTo(0, 0);
}

function addMember(name) {
  const clean = name.trim();
  if (!clean || state.members.length >= MAX_MEMBERS) return;
  const i = state.members.length;
  state.members.push(clean);
  state.items.forEach((it) => it.who.push(i)); // 새 사람은 기본적으로 모든 항목에 참여
  if (state.members.length >= 2) trackOnce('member_add', { member_count: state.members.length });
  saveDraft();
  render();
  root.querySelector('[data-key="new-member"]')?.focus();
}

function removeMember(i) {
  state.members.splice(i, 1);
  state.items.forEach((it) => {
    it.who = it.who.filter((w) => w !== i).map((w) => (w > i ? w - 1 : w));
  });
  if (state.payer === i) state.payer = 0;
  else if (state.payer > i) state.payer -= 1;
  saveDraft();
  render();
}

function trySettle() {
  // 이름 칸이 빈 참여자는 번호로 채움
  state.members = state.members.map((m, i) => m.trim() || `${i + 1}번`);
  errors = validate(state);
  if (errors.length) {
    render();
    root.querySelector('.errors')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const r = settle(state);
  track('calc_complete', {
    member_count: state.members.length,
    item_count: state.items.length,
    has_exclusion: hasExclusion(state),
    total_amount_range: amountRange(r.total),
  });
  state.shareId = newShareId();
  saveDraft();
  view = 'result';
  render();
  window.scrollTo(0, 0);
}

async function share(method) {
  const url = buildShareUrl(state, state.shareId || newShareId());
  const title = state.title || '모임';
  const text = `${title} 정산이에요. 내가 낼 금액을 확인해 주세요.`;
  track('share_link', { share_method: method, share_id: state.shareId });

  if (method === 'web_share') {
    try {
      await navigator.share({ title: `공평셈 · ${title} 정산`, text, url });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return; // 사용자가 공유 창을 닫음
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = `${text}\n${url}`;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('링크를 복사했어요. 단톡방에 붙여 넣어 보내세요.');
}

function newFromShared() {
  track('shared_to_new_calc', { share_id: shared?.shareId || '' });
  history.replaceState(null, '', location.pathname + location.search);
  shared = null;
  state = freshState();
  started = false;
  resetOnce('calc_start', 'member_add', 'item_add');
  saveDraft();
  goCalc('shared');
}

/* ---------- 이벤트 위임 ---------- */

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'FORM') return;
  const a = el.dataset.action;
  const i = Number(el.dataset.i);
  const k = Number(el.dataset.k);

  if (a === 'start') return goCalc(el.dataset.pos || 'hero');
  if (a === 'home') {
    if (view === 'shared') return;
    view = getVariant() === 'A' && !started ? 'landing' : 'calc';
    return render();
  }
  if (a === 'remove-member') return removeMember(i);
  if (a === 'payer') { state.payer = i; saveDraft(); return render(); }
  if (a === 'toggle-who') {
    markStarted('calc');
    const who = state.items[k].who;
    state.items[k].who = who.includes(i) ? who.filter((w) => w !== i) : [...who, i].sort((x, y) => x - y);
    saveDraft();
    return render();
  }
  if (a === 'add-item') {
    markStarted('calc');
    state.items.push({ name: '', amount: 0, who: state.members.map((_, j) => j) });
    saveDraft();
    render();
    root.querySelector(`[data-key="item-name-${state.items.length - 1}"]`)?.focus();
    return;
  }
  if (a === 'remove-item') { state.items.splice(k, 1); saveDraft(); return render(); }
  if (a === 'unit') { state.unit = Number(el.dataset.u); saveDraft(); return render(); }
  if (a === 'settle') return trySettle();
  if (a === 'share') return share(el.dataset.method);
  if (a === 'edit') { view = 'calc'; errors = []; return render(); }
  if (a === 'new-from-shared') return newFromShared();
});

root.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-action="add-member"]');
  if (!form) return;
  e.preventDefault();
  markStarted('calc');
  addMember(form.elements.name.value);
});

root.addEventListener('focusin', (e) => {
  if (view === 'calc' && e.target.matches('input')) markStarted('calc');
});

root.addEventListener('input', (e) => {
  const el = e.target;
  const f = el.dataset.field;
  if (!f) return;
  if (f === 'member') {
    state.members[Number(el.dataset.i)] = el.value;
    el.style.setProperty('--len', Math.max(el.value.length, 1));
    // 결제자·항목 칩의 이름만 갱신 (입력 중 포커스 유지)
    root.querySelectorAll(`[data-action="payer"][data-i="${el.dataset.i}"], [data-action="toggle-who"][data-i="${el.dataset.i}"]`)
      .forEach((b) => { b.textContent = el.value || `${Number(el.dataset.i) + 1}번`; });
  } else if (f === 'item-name') {
    state.items[Number(el.dataset.k)].name = el.value;
  } else if (f === 'item-amount') {
    const n = Math.min(digits(el.value), 99999999);
    state.items[Number(el.dataset.k)].amount = n;
    el.value = fmt(n);
    const t = root.querySelector('[data-total]');
    if (t) t.textContent = won(total());
    if (n > 0) {
      trackOnce('item_add', { item_count: state.items.length, has_exclusion: hasExclusion(state) });
    }
  } else if (f === 'title') {
    state.title = el.value;
  }
  if (errors.length) { errors = []; root.querySelector('.errors')?.remove(); }
  saveDraft();
});

/* ---------- 시작 ---------- */

function boot() {
  initTracking();
  const fromHash = readShareHash(location.hash);
  if (location.hash.includes('s=')) {
    setEntryType('shared');
    shared = fromHash;
    view = 'shared';
    render();
    track('shared_view', { share_id: fromHash?.shareId || '', valid: Boolean(fromHash) });
    return;
  }
  view = getVariant() === 'A' ? 'landing' : 'calc';
  render();
  track('landing_view', { landing_type: view === 'landing' ? 'explain' : 'instant' });
}

boot();
