// 공평셈 — 화면과 상호작용
// 흐름: (랜딩 A) → 1 함께한 사람 → 2 장소와 결제금액 → 3 결제한 사람·빠진 사람 → 정산 중 → 결과
import {
  settle, validateMembers, validateItems, validatePeople, hasExclusion, amountRange, won, iga,
  MAX_MEMBERS, MAX_ITEMS,
} from './calc.js';
import { newShareId, buildShareUrl, readShareHash } from './share.js';
import { initTracking, getVariant, setEntryType, track, trackOnce, resetOnce } from './track.js';

const root = document.getElementById('app');
const DRAFT_KEY = 'gps_draft_v2';
const STEPS = { step1: 1, step2: 2, step3: 3 };
const LOADING_MS = 1500;

/* ---------- 상태 ---------- */

const emptyItem = () => ({ name: '', amount: 0, who: null, payer: null });
const freshState = () => ({ members: [], items: [emptyItem()] });

let state = loadDraft() || freshState();
let view = 'landing'; // landing | step1 | step2 | step3 | loading | result | shared
let shared = null; // 공유 링크로 들어온 경우 { state, shareId }
let errors = [];
let started = false;
let shareId = '';

function loadDraft() {
  try {
    const s = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (s && Array.isArray(s.members) && Array.isArray(s.items) && s.items.length) return s;
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
const placeName = (it, k) => it.name?.trim() || `${k + 1}번째 장소`;
const everyone = () => state.members.map((_, i) => i);

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

/* ---------- 화면 이동 ---------- */

function go(next, { direction = 'next', push = true } = {}) {
  view = next;
  errors = [];
  if (next === 'step3') prepareStep3();
  if (push) history.pushState({ view: next }, '');
  render();
  window.scrollTo(0, 0);
  if (STEPS[next]) track('step_view', { step: STEPS[next], direction });
  const first = root.querySelector('[data-autofocus]');
  if (first && direction !== 'back') first.focus({ preventScroll: true });
}

/** 3단계 진입 시: 함께한 사람 기본값은 전원 */
function prepareStep3() {
  state.items.forEach((it) => {
    if (!Array.isArray(it.who)) it.who = everyone();
  });
  saveDraft();
}

window.addEventListener('popstate', (e) => {
  const to = e.state?.view;
  if (!to || to === 'loading' || view === 'shared') return;
  if (to === 'result') {
    try { settle(state); } catch { return go('step3', { direction: 'back', push: false }); }
  }
  go(to, { direction: 'back', push: false });
});

/* ---------- 렌더 ---------- */

function render() {
  const active = document.activeElement;
  const focusKey = active?.dataset?.key;
  const caret = active?.selectionStart;

  root.innerHTML = {
    landing: viewLanding,
    step1: viewStep1,
    step2: viewStep2,
    step3: viewStep3,
    loading: viewLoading,
    result: viewResult,
    shared: viewShared,
  }[view]();

  if (focusKey) {
    const el = root.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (caret != null && el.setSelectionRange && el.type === 'text') {
        try { el.setSelectionRange(caret, caret); } catch { /* noop */ }
      }
    }
  }
}

const bar = (step) => `
  <header class="bar">
    <button class="brand" data-action="home" aria-label="공평셈 처음으로">공평셈</button>
    ${step ? `<span class="progress" aria-label="${step}단계 중 3단계">
      ${[1, 2, 3].map((s) => `<i class="${s <= step ? 'on' : ''}"></i>`).join('')}
      <b>${step} / 3</b></span>` : ''}
  </header>`;

const errorBox = () => (errors.length
  ? `<div class="errors" role="alert">${errors.map((e) => `<p>${esc(e)}</p>`).join('')}</div>` : '');

const dock = ({ back, nextLabel = '다음', nextAction = 'next' }) => `
  <div class="dock">
    ${back ? `<button class="btn btn--ghost dock-back" data-action="back">이전</button>` : ''}
    <button class="btn btn--primary dock-next" data-action="${nextAction}">${nextLabel}</button>
  </div>`;

/* 랜딩 A: 설명형 */
function viewLanding() {
  return `
  ${bar()}
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

/* 1단계: 함께한 사람 */
function viewStep1() {
  const n = state.members.length;
  const chips = state.members.map((m, i) => `
    <li class="chip chip--member">
      <input class="chip-input" style="--len:${Math.max(m.length, 1)}" data-key="member-${i}" data-field="member" data-i="${i}" value="${esc(m)}" aria-label="${i + 1}번째 사람 이름" maxlength="10">
      <button class="chip-x" data-action="remove-member" data-i="${i}" aria-label="${esc(m)} 빼기">×</button>
    </li>`).join('');

  return `
  ${bar(1)}
  <main class="step">
    ${getVariant() === 'B' ? '<p class="kicker">1/N 말고, 먹은 만큼 나눠요.</p>' : ''}
    <h1 class="step-title">함께한 사람을<br>적어주세요</h1>
    <p class="step-sub">나를 포함해 함께한 사람의 이름을 모두 적어주세요.</p>

    ${n ? `<ul class="chips">${chips}</ul>` : ''}
    ${n < MAX_MEMBERS ? `
    <form class="add-row" data-action="add-member">
      <input class="field" data-key="new-member" data-autofocus name="name" placeholder="이름" maxlength="10" autocomplete="off" enterkeyhint="done" aria-label="추가할 사람 이름">
      <button class="btn btn--ghost" type="submit">추가</button>
    </form>` : ''}
    <p class="hint">${n < 2 ? '2명 이상 적으면 다음으로 넘어갈 수 있어요.' : `${n}명이 함께했어요.`}</p>
    ${errorBox()}
  </main>
  ${dock({ back: getVariant() === 'A' })}`;
}

/* 2단계: 장소와 결제금액 */
function viewStep2() {
  const items = state.items.map((it, k) => `
    <li class="item">
      <div class="item-row">
        <input class="field field--name" data-key="item-name-${k}" ${k === 0 ? 'data-autofocus' : ''} data-field="item-name" data-k="${k}" value="${esc(it.name)}" placeholder="${['1차 삼겹살집', '2차 호프집', '3차 노래방', '카페'][k % 4]}" aria-label="${k + 1}번째 장소" maxlength="20">
        <label class="field field--amount">
          <input data-key="item-amt-${k}" data-field="item-amount" data-k="${k}" value="${fmt(it.amount)}" inputmode="numeric" placeholder="0" aria-label="${k + 1}번째 장소 결제금액">
          <span>원</span>
        </label>
        ${state.items.length > 1 ? `<button class="icon-x" data-action="remove-item" data-k="${k}" aria-label="${k + 1}번째 장소 삭제">×</button>` : ''}
      </div>
    </li>`).join('');

  return `
  ${bar(2)}
  <main class="step">
    <h1 class="step-title">장소와 결제금액을<br>적어주세요</h1>
    <p class="step-sub">1차, 2차처럼 결제한 곳마다 따로 적어주세요.</p>
    <ul class="items">${items}</ul>
    ${state.items.length < MAX_ITEMS ? `<button class="btn btn--ghost btn--wide" data-action="add-item">장소 추가</button>` : ''}
    <p class="sum"><span>합계</span><b data-total>${won(total())}</b></p>
    ${errorBox()}
  </main>
  ${dock({ back: true })}`;
}

/* 3단계: 결제한 사람과 빠진 사람 */
function viewStep3() {
  const cards = state.items.map((it, k) => {
    const out = everyone().filter((i) => !it.who.includes(i));
    const options = state.members.map((m, i) =>
      `<option value="${i}" ${it.payer === i ? 'selected' : ''}>${esc(iga(m))} 결제했어요</option>`).join('');
    return `
    <li class="item item--people">
      <div class="place">
        <span>${esc(placeName(it, k))}</span><b>${won(it.amount)}</b>
      </div>
      <label class="payer ${it.payer == null ? 'is-empty' : ''}">
        <select data-field="payer" data-k="${k}" data-key="payer-${k}" aria-label="${esc(placeName(it, k))} 결제한 사람">
          ${it.payer == null ? '<option value="" selected disabled>누가 결제했나요?</option>' : ''}
          ${options}
        </select>
      </label>
      <p class="label">함께한 사람</p>
      <div class="who" role="group" aria-label="${esc(placeName(it, k))}에 함께한 사람">
        ${state.members.map((m, i) => `
          <button class="who-chip ${it.who.includes(i) ? 'on' : ''}" data-action="toggle-who" data-k="${k}" data-i="${i}" aria-pressed="${it.who.includes(i)}" data-key="who-${k}-${i}">${esc(m)}</button>`).join('')}
      </div>
      ${out.length ? `<p class="item-note">${out.map((i) => esc(state.members[i])).join(', ')} 빠짐</p>` : ''}
    </li>`;
  }).join('');

  return `
  ${bar(3)}
  <main class="step">
    <h1 class="step-title">결제한 사람과<br>빠진 사람을 알려주세요</h1>
    <p class="step-sub">장소마다 결제한 사람을 고르고, 빠진 사람은 이름을 눌러 꺼 주세요.</p>
    <ul class="items">${cards}</ul>
    ${errorBox()}
  </main>
  ${dock({ back: true, nextLabel: '정산하기', nextAction: 'settle' })}`;
}

/* 정산 중 */
function viewLoading() {
  return `
  ${bar()}
  <main class="loading" aria-busy="true">
    <div class="printer" aria-hidden="true">
      <div class="paper"><i></i><i></i><i></i><i></i></div>
    </div>
    <h1 class="step-title">정산 중이에요</h1>
    <p class="step-sub">장소마다 함께한 사람끼리 나누고 있어요.</p>
  </main>`;
}

function receipt(s, r) {
  const name = (i) => esc(s.members[i]);
  const list = (xs) => xs.map((x) => `${esc(x.name)} ${won(x.share)}`).join(' · ');

  const transfers = r.transfers.length
    ? r.transfers.map((t) => `
      <li>
        <span class="flow">${name(t.from)}<i aria-label="에게서">→</i>${name(t.to)}</span><b>${won(t.amount)}</b>
        <small>${list(t.items)}${t.offsets.length ? ` <span class="minus">− ${list(t.offsets)} 상계</span>` : ''}</small>
      </li>`).join('')
    : '<li class="none"><span>보낼 돈이 없어요</span><small>각자 결제한 금액이 자기 몫과 같아요.</small></li>';

  const people = r.people.map((p) => `
      <li>
        <span>${esc(p.name)}${p.missed.length ? `<em class="out">${p.missed.map(esc).join(', ')} 빠짐</em>` : ''}</span>
        <b>${won(p.cost)}</b>
        ${p.paid ? `<small>결제 ${won(p.paid)}${p.extra ? ` · 끝전 ${won(p.extra)} 부담` : ''}</small>` : ''}
      </li>`).join('');

  return `
  <article class="receipt" aria-label="정산 영수증">
    <div class="receipt-head">
      <span>공평셈 정산</span><span>${s.members.length}명 · ${s.items.length}곳</span>
    </div>
    <p class="receipt-label">보낼 돈</p>
    <ul class="lines">${transfers}</ul>
    <p class="receipt-label">각자 쓴 돈</p>
    <ul class="lines lines--quiet">${people}</ul>
    <div class="receipt-total"><span>총액</span><b>${won(r.total)}</b></div>
    <p class="receipt-foot">1원 단위로 나눠요 · 끝전은 그 장소를 결제한 사람이 부담해요</p>
  </article>`;
}

function viewResult() {
  const r = settle(state);
  const canShare = typeof navigator.share === 'function';
  return `
  ${bar()}
  <main class="result">
    <h1 class="result-title">정산이 끝났어요</h1>
    ${receipt(state, r)}
    <div class="actions">
      ${canShare ? `<button class="btn btn--primary btn--wide" data-action="share" data-method="web_share">단톡방에 보내기</button>` : ''}
      <button class="btn ${canShare ? 'btn--ghost' : 'btn--primary'} btn--wide" data-action="share" data-method="copy">링크 복사</button>
      <div class="actions-row">
        <button class="btn btn--text" data-action="edit">내역 수정하기</button>
        <button class="btn btn--text" data-action="reset">새 정산 시작하기</button>
      </div>
    </div>
  </main>`;
}

function viewShared() {
  let r = null;
  try { if (shared) r = settle(shared.state); } catch { r = null; }
  if (!r) {
    return `${bar()}<main class="result"><h1 class="result-title">링크를 열 수 없어요</h1>
      <p class="hint">링크가 중간에 잘렸을 수 있어요. 보낸 사람에게 링크를 다시 받아 주세요.</p>
      <button class="btn btn--primary btn--wide" data-action="new-from-shared">새 정산 만들기</button></main>`;
  }
  return `
  ${bar()}
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

function addMember(raw) {
  const clean = String(raw || '').trim();
  if (!clean || state.members.length >= MAX_MEMBERS) return false;
  const i = state.members.length;
  state.members.push(clean);
  state.items.forEach((it) => { if (Array.isArray(it.who)) it.who.push(i); });
  if (state.members.length >= 2) trackOnce('member_add', { member_count: state.members.length });
  saveDraft();
  return true;
}

function removeMember(i) {
  state.members.splice(i, 1);
  state.items.forEach((it) => {
    if (Array.isArray(it.who)) it.who = it.who.filter((w) => w !== i).map((w) => (w > i ? w - 1 : w));
    if (it.payer === i) it.payer = null;
    else if (it.payer > i) it.payer -= 1;
  });
  saveDraft();
  render();
}

function showErrors(list) {
  errors = list;
  render();
  root.querySelector('.errors')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function next() {
  if (view === 'step1') {
    // 입력칸에 적고 '추가'를 안 눌렀다면 자동으로 추가
    const pending = root.querySelector('[data-key="new-member"]')?.value;
    if (pending?.trim()) addMember(pending);
    state.members = state.members.map((m) => m.trim());
    const errs = validateMembers(state);
    if (errs.length) return showErrors(errs);
    saveDraft();
    return go('step2');
  }
  if (view === 'step2') {
    // 이름도 금액도 없는 빈 칸은 정리
    const kept = state.items.filter((it) => it.name.trim() || it.amount);
    state.items = kept.length ? kept : [emptyItem()];
    const errs = validateItems(state);
    if (errs.length) return showErrors(errs);
    saveDraft();
    return go('step3');
  }
}

function back() {
  if (view === 'step1') return go('landing', { direction: 'back' });
  if (view === 'step2') return go('step1', { direction: 'back' });
  if (view === 'step3') return go('step2', { direction: 'back' });
}

function trySettle() {
  const errs = validatePeople(state);
  if (errs.length) return showErrors(errs);
  const r = settle(state);
  track('calc_complete', {
    member_count: state.members.length,
    item_count: state.items.length,
    has_exclusion: hasExclusion(state),
    total_amount_range: amountRange(r.total),
  });
  shareId = newShareId();
  saveDraft();
  go('loading', { push: false });
  setTimeout(() => go('result'), LOADING_MS);
}

async function share(method) {
  const url = buildShareUrl(state, shareId || (shareId = newShareId()));
  const text = '공평셈으로 정산했어요. 내가 보낼 금액을 확인해 주세요.';
  track('share_link', { share_method: method, share_id: shareId });

  if (method === 'web_share') {
    try {
      await navigator.share({ title: '공평셈 정산 결과', text, url });
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

function resetAll(position) {
  state = freshState();
  started = false;
  shareId = '';
  resetOnce('calc_start', 'member_add', 'item_add');
  saveDraft();
  markStarted(position);
  go('step1', { direction: 'start' });
}

function newFromShared() {
  track('shared_to_new_calc', { share_id: shared?.shareId || '' });
  history.replaceState({ view: 'step1' }, '', location.pathname + location.search);
  shared = null;
  resetAll('shared');
}

/* ---------- 이벤트 위임 ---------- */

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'FORM') return;
  const a = el.dataset.action;
  const i = Number(el.dataset.i);
  const k = Number(el.dataset.k);

  if (a === 'start') { markStarted(el.dataset.pos || 'hero'); return go('step1', { direction: 'start' }); }
  if (a === 'home') {
    if (view === 'shared' || view === 'loading') return;
    return go(getVariant() === 'A' ? 'landing' : 'step1', { direction: 'back' });
  }
  if (a === 'next') return next();
  if (a === 'back') return back();
  if (a === 'remove-member') return removeMember(i);
  if (a === 'add-item') {
    state.items.push(emptyItem());
    saveDraft();
    render();
    root.querySelector(`[data-key="item-name-${state.items.length - 1}"]`)?.focus();
    return;
  }
  if (a === 'remove-item') { state.items.splice(k, 1); saveDraft(); return render(); }
  if (a === 'toggle-who') {
    const who = state.items[k].who;
    state.items[k].who = who.includes(i) ? who.filter((w) => w !== i) : [...who, i].sort((x, y) => x - y);
    errors = [];
    saveDraft();
    return render();
  }
  if (a === 'settle') return trySettle();
  if (a === 'share') return share(el.dataset.method);
  if (a === 'edit') return go('step3', { direction: 'edit' });
  if (a === 'reset') return resetAll('reset');
  if (a === 'new-from-shared') return newFromShared();
});

root.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-action="add-member"]');
  if (!form) return;
  e.preventDefault();
  markStarted('calc');
  if (addMember(form.elements.name.value)) {
    errors = [];
    render();
    root.querySelector('[data-key="new-member"]')?.focus();
  }
});

root.addEventListener('focusin', (e) => {
  if (view === 'step1' && e.target.matches('input')) markStarted('calc');
});

root.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.field !== 'payer') return;
  const k = Number(el.dataset.k);
  const p = Number(el.value);
  state.items[k].payer = p;
  // 아직 결제자를 안 고른 다른 장소는 같은 사람으로 채워 둠 (대부분 한 사람이 결제)
  state.items.forEach((it) => { if (it.payer == null) it.payer = p; });
  errors = [];
  saveDraft();
  render();
});

root.addEventListener('input', (e) => {
  const el = e.target;
  const f = el.dataset.field;
  if (!f || f === 'payer') return;
  if (f === 'member') {
    state.members[Number(el.dataset.i)] = el.value;
    el.style.setProperty('--len', Math.max(el.value.length, 1));
  } else if (f === 'item-name') {
    state.items[Number(el.dataset.k)].name = el.value;
  } else if (f === 'item-amount') {
    const n = Math.min(digits(el.value), 99999999);
    state.items[Number(el.dataset.k)].amount = n;
    el.value = fmt(n);
    const t = root.querySelector('[data-total]');
    if (t) t.textContent = won(total());
    if (n > 0) trackOnce('item_add', { item_count: state.items.length });
  }
  if (errors.length) { errors = []; root.querySelector('.errors')?.remove(); }
  saveDraft();
});

/* ---------- 시작 ---------- */

function boot() {
  initTracking();
  if (location.hash.includes('s=')) {
    const fromHash = readShareHash(location.hash);
    setEntryType('shared');
    shared = fromHash;
    view = 'shared';
    history.replaceState({ view: 'shared' }, '');
    render();
    track('shared_view', { share_id: fromHash?.shareId || '', valid: Boolean(fromHash) });
    return;
  }
  const first = getVariant() === 'A' ? 'landing' : 'step1';
  track('landing_view', { landing_type: first === 'landing' ? 'explain' : 'instant' });
  history.replaceState({ view: first }, '');
  view = first;
  render();
  if (first === 'step1') track('step_view', { step: 1, direction: 'start' });
}

boot();
