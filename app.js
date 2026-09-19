/*
 * app.js — 画面(ハッシュルーティングの単一ページ)
 * データの読み書きは必ず Store 経由で行う。
 * ユーザーの入力を表示するときは必ず esc() / nl2br() を通す(XSS対策)。
 */
(function () {
  'use strict';

  const S = window.Store;
  const R = S.RULES;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const app = $('#app');

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl2br = (s) => esc(s).replace(/\n/g, '<br>');

  const state = { cat: '', q: '', sort: 'new', rank: 'total', notice: '' };
  let pageTitle = 'ひろば掲示板';
  let bumpUntil = 0; // ポイントが増えた直後、ヘッダーのポイント表示を弾ませる
  let popId = null; // いいねした投稿(ハートを弾ませる)
  let io = null;

  // ---------- アイコン(線画SVG) ----------
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    gift: '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    heart: '<path d="M12 20.5s-8-4.6-8-10.4A4.6 4.6 0 0 1 12 7.6a4.6 4.6 0 0 1 8 2.5c0 5.8-8 10.4-8 10.4z"/>',
    msg: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    reply: '<path d="M9 14 4 9l5-5M4 9h9a7 7 0 0 1 7 7v3"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    back: '<path d="m15 6-6 6 6 6"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6z"/>',
    logout: '<path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4M16 17l5-5-5-5M21 12H9"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  };
  const ico = (n) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

  // ---------- カテゴリの見た目 ----------
  const CAT = {
    '雑談': { i: '💬', h: 170 },
    '相談・質問': { i: '🙋', h: 18 },
    '仕事・副業': { i: '💼', h: 215 },
    '健康・リハビリ': { i: '🌿', h: 140 },
    '趣味': { i: '🎨', h: 285 },
    '意見交換': { i: '🗣️', h: 42 },
  };
  const catOf = (c) => CAT[c] || { i: '📌', h: 200 };
  const catTag = (c) => `<span class="cat" style="--h:${catOf(c).h}">${catOf(c).i} ${esc(c)}</span>`;

  // ---------- 小さな部品 ----------
  function ago(ts) {
    const d = (Date.now() - ts) / 1000;
    if (d < 60) return 'たった今';
    if (d < 3600) return Math.floor(d / 60) + '分前';
    if (d < 86400) return Math.floor(d / 3600) + '時間前';
    if (d < 86400 * 7) return Math.floor(d / 86400) + '日前';
    return new Date(ts).toLocaleDateString('ja-JP');
  }
  const hueOf = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const avatar = (u, size) => `<span class="av ${size || ''}" style="--h:${hueOf(u.nickname)}" aria-hidden="true">${esc(Array.from(u.nickname)[0] || '?')}</span>`;
  const ringAvatar = (u, size) => `<span class="ring ${size || ''}" style="--p:${Math.round(u.level.progress * 100)}" title="Lv.${u.level.lv} ${esc(u.level.title)}">${avatar(u, size)}</span>`;
  const lvChip = (u) => `<span class="lv" title="${esc(u.level.title)}">Lv.${u.level.lv}</span>`;
  const userLine = (u) => `<span class="who">${esc(u.nickname)}</span> ${lvChip(u)}`;

  // ---------- 下書き(書きかけの内容を失わないように自動保存) ----------
  const DRAFT = 'keijiban_draft_v1';
  function getDraft() { try { return JSON.parse(localStorage.getItem(DRAFT)) || {}; } catch (e) { return {}; } }
  function setDraft(d) { try { localStorage.setItem(DRAFT, JSON.stringify(d)); } catch (e) { /* 保存できなくても続行 */ } }
  let draftLock = 0;
  function clearDraft() {
    draftLock = Date.now() + 1500; // 投稿直後に画面が切り替わるときの入力イベントで下書きが復活しないようにする
    try { localStorage.removeItem(DRAFT); } catch (e) { /* 無視 */ }
  }
  function saveDraftFrom(form) {
    if (Date.now() < draftLock || !form.isConnected) return;
    const fd = new FormData(form);
    setDraft({ category: fd.get('category'), title: fd.get('title'), body: fd.get('body') });
  }

  // ---------- 通知 ----------
  function toast(msg, kind, icon) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.innerHTML = (icon ? `<span class="ic">${icon}</span>` : '') + `<span>${esc(msg)}</span>`;
    const box = $('#toasts');
    while (box.children.length >= 3) box.firstChild.remove();
    box.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  function celebrate(lv, title) {
    const colors = ['#f7c948', '#ff7f5c', '#35c3a4', '#6aa7ff', '#ff8fb1', '#b58cff'];
    let conf = '';
    for (let i = 0; i < 34; i++) {
      conf += `<i style="--x:${Math.round(Math.random() * 100)}%;--c:${colors[i % colors.length]};--d:${(Math.random() * 0.8).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg"></i>`;
    }
    $('#celebrate').innerHTML = `<div class="cel-back" data-act="closeCelebrate">
      <div class="cel" role="dialog" aria-modal="true" aria-label="レベルアップ"><div class="conf">${conf}</div>
        <div class="cel-badge">Lv.${lv}</div><h2>レベルアップ!</h2><p>「${esc(title)}」になりました</p>
        <button class="btn cta" data-act="closeCelebrate" data-force="1">つづける</button></div></div>`;
    clearTimeout(celebrate.t);
    celebrate.t = setTimeout(() => { $('#celebrate').innerHTML = ''; }, 6000);
  }

  function flush() {
    S.drainNotices().forEach((n) => {
      if (n.type === 'points') {
        if (n.amount > 0) bumpUntil = Date.now() + 900;
        toast((n.amount > 0 ? '+' : '') + n.amount + 'pt  ' + n.reason, n.amount > 0 ? 'pt' : 'err', n.amount > 0 ? '✨' : '');
      } else if (n.type === 'levelup') {
        celebrate(n.lv, n.title);
      }
    });
  }

  // ---------- ヘッダー・下タブ ----------
  function renderHeader(seg) {
    const me = S.currentUser();
    const nav = (href, label, key) => `<a href="${href}" class="${seg === key ? 'on' : ''}">${label}</a>`;
    const acct = !S.ready ? '' : me
      ? `<a class="pchip ${Date.now() < bumpUntil ? 'bump' : ''}" href="#/me" aria-label="マイページ(${me.points}ポイント)">${ringAvatar(me, 'sm')}<span class="pchip-t"><b>Lv.${me.level.lv}</b><small>${me.points}pt</small></span></a>
         <a class="btn cta sm desk" href="#/new">${ico('pen')}投稿する</a>`
      : `<a class="btn ghost sm" href="#/login">ログイン</a><a class="btn cta sm" href="#/register">無料で始める</a>`;
    $('#header').innerHTML = `<div class="wrap bar">
      <a class="brand" href="#/"><span class="logo"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4 3.5V17H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg></span>ひろば</a>
      <nav class="nav desk" aria-label="ページ">${nav('#/', 'ホーム', '')}${nav('#/ranking', 'ランキング', 'ranking')}${nav('#/rules', 'ポイントのしくみ', 'rules')}${me && me.isAdmin ? nav('#/admin', '管理', 'admin') : ''}</nav>
      <div class="acct">${acct}</div>
    </div>`;

    const tab = (href, icon, label, key) => `<a href="${href}" class="${seg === key ? 'on' : ''}" ${seg === key ? 'aria-current="page"' : ''}>${ico(icon)}<span>${label}</span></a>`;
    $('#tabbar').innerHTML = `${tab('#/', 'home', 'ホーム', '')}${tab('#/ranking', 'trophy', 'ランキング', 'ranking')}
      <a class="fab" href="#/new" aria-label="スレッドを立てる">${ico('plus')}</a>
      ${tab('#/rules', 'gift', 'ポイント', 'rules')}${me ? tab('#/me', 'user', 'マイページ', 'me') : tab('#/login', 'user', 'ログイン', 'login')}`;
  }

  // ---------- 共通ブロック ----------
  function missionList(m) {
    return `<ul class="mis">${m.items.map((i) => `<li class="${i.done ? 'done' : ''}"><span class="tick">${i.done ? ico('check') : ''}</span><span class="grow">${esc(i.label)}</span><b>+${i.pts}pt</b></li>`).join('')}
      <li class="bonus ${m.bonusDone ? 'done' : ''}"><span class="tick">${m.bonusDone ? ico('check') : ico('gift')}</span><span class="grow">スレッド+返信で ボーナス</span><b>+${m.bonus}pt</b></li></ul>
      <div class="cap"><div class="cap-h"><span>今日の投稿ポイント</span><b>${m.postPt.used} / ${m.postPt.cap}pt</b></div>
      <div class="bar-track"><div class="bar-fill brand" style="width:${Math.min(100, Math.round((m.postPt.used / m.postPt.cap) * 100))}%"></div></div></div>`;
  }

  function topicCard(cls) {
    const t = S.todayTopic();
    return `<section class="card topic ${cls}">
      <div class="topic-h">${ico('bulb')} 今日のお題</div>
      <h3>${esc(t.title)}</h3><p>${esc(t.hint)}</p>
      <button class="btn cta sm" data-act="useTopic">${ico('pen')}このお題で投稿<span class="chip-pt">+${R.thread}pt</span></button>
    </section>`;
  }

  function catPills(sel) {
    return `<div class="pills" role="radiogroup" aria-label="カテゴリ">${S.CATEGORIES.map((c) =>
      `<label class="pill"><input type="radio" name="category" value="${esc(c)}" ${c === sel ? 'checked' : ''}><span>${catOf(c).i} ${esc(c)}</span></label>`).join('')}</div>`;
  }
  function draftCategory() {
    const d = getDraft();
    if (S.CATEGORIES.includes(d.category)) return d.category;
    return S.CATEGORIES.includes(state.cat) ? state.cat : S.CATEGORIES[0];
  }

  function needLogin(msg) {
    return `<div class="card narrow empty"><span class="big">🔑</span><p>${esc(msg)}</p>
      <div class="row" style="justify-content:center"><a class="btn cta" href="#/login">ログイン</a><a class="btn" href="#/register">新規登録で +${R.register}pt</a></div></div>`;
  }
  function notFound() {
    return '<div class="card narrow empty"><span class="big">🧭</span><p>ページが見つかりませんでした。</p><a class="btn brand" href="#/">ホームに戻る</a></div>';
  }

  // ---------- 画面: ホーム ----------
  function feedItemHtml(r) {
    return `<a class="card feed" href="#/thread/${esc(r.thread.id)}">
      ${avatar(r.author, 'md')}
      <div class="feed-main">
        <div class="feed-top">${catTag(r.thread.category)}${r.hasBest ? `<span class="tag solved">${ico('check')} 解決済み</span>` : ''}<span class="time">${ago(r.last)}</span></div>
        <h3>${esc(r.thread.title)}</h3>
        <p class="excerpt">${esc(r.excerpt)}</p>
        <div class="feed-meta">
          <span class="who">${esc(r.author.nickname)}</span>${lvChip(r.author)}
          <span class="stat">${ico('msg')}${r.replies}</span><span class="stat">${ico('heart')}${r.likes}</span>
          ${r.replies === 0 ? `<span class="tag wait">返信を待っています +${R.reply}pt</span>` : ''}
        </div>
      </div>
    </a>`;
  }

  function threadListHtml() {
    const rows = S.listThreads({ category: state.cat, q: state.q, sort: state.sort });
    if (!rows.length) {
      const msg = state.sort === 'wait' ? '返信待ちのスレッドはありません。みんなに届いています!' : '該当するスレッドがありません。<br>最初のスレッドを立ててみませんか?';
      return `<div class="card empty"><span class="big">🌱</span>${msg}<div style="margin-top:12px"><a class="btn cta" href="#/new">${ico('pen')}スレッドを立てる</a></div></div>`;
    }
    return rows.map(feedItemHtml).join('');
  }

  function chipsHtml() {
    return ['', ...S.CATEGORIES].map((c) =>
      `<button class="chip ${state.cat === c ? 'on' : ''}" data-act="cat" data-val="${esc(c)}">${c ? catOf(c).i + ' ' + esc(c) : 'すべて'}</button>`).join('');
  }
  function segHtml() {
    return [['new', '新着'], ['hot', '人気'], ['wait', '返信待ち']].map(([k, l]) =>
      `<button class="${state.sort === k ? 'on' : ''}" data-act="sort" data-val="${k}">${l}</button>`).join('');
  }

  function composerHome(me) {
    const d = getDraft();
    return `<form class="card composer ${d.title || d.body ? 'has-draft' : ''}" data-form="newthread" autocomplete="off">
      <div class="composer-top">${ringAvatar(me, 'md')}
        <input type="text" name="title" class="composer-title" maxlength="60" placeholder="気になること、聞いてみたいこと、なんでも書いてみよう" value="${esc(d.title || '')}" aria-label="スレッドのタイトル" required>
      </div>
      <div class="composer-more">
        ${catPills(draftCategory())}
        <div class="field"><textarea name="body" maxlength="2000" data-max="2000" data-min="${R.minLength}" data-keep placeholder="本文を書く(${R.minLength}文字以上でポイント対象)" aria-label="本文" required>${esc(d.body || '')}</textarea>
          <div class="meta"><span class="hint"></span><span class="counter">0 / 2000</span></div></div>
        <div class="composer-foot"><span class="small muted">下書きは自動で保存されます</span>
          <button class="btn cta">投稿する<span class="chip-pt">+${R.thread}pt</span></button></div>
      </div>
    </form>`;
  }

  function heroGuest() {
    return `<section class="card hero">
      <h1>あなたの一言が、<br>誰かの<em>ヒント</em>になる。</h1>
      <p>投稿・返信・いいねでポイントがたまる、みんなの意見交換ひろば。ゆるく、気軽に、話してみませんか?</p>
      <div class="row"><a class="btn light lg" href="#/register">無料で始めて +${R.register}pt</a><a class="btn ghost" style="color:#fff;border-color:rgba(255,255,255,.5)" href="#/login">ログイン</a></div>
      <ul class="hero-points"><li><b>+${R.thread}</b>スレッドを立てる</li><li><b>+${R.reply}</b>返信する</li><li><b>+${R.best}</b>ベストアンサー</li></ul>
    </section>`;
  }

  function missionStrip() {
    const m = S.missions();
    return `<a class="card mstrip" href="#/me" aria-label="今日のミッション"><b>🎯 今日のミッション</b>${m.items.slice(1).map((i) =>
      `<span class="mchip ${i.done ? 'done' : ''}">${i.done ? ico('check') : ''}${esc(i.label)} +${i.pts}</span>`).join('')}<span class="mchip ${m.bonusDone ? 'done' : ''}">両方で +${m.bonus}</span></a>`;
  }

  function progressCard(me) {
    const lv = me.level;
    const m = S.missions();
    const next = lv.next ? `次のLv.${lv.next.lv}まで あと ${lv.next.min - me.points}pt` : '最高レベルです!';
    return `<section class="card">
      <div class="prog-top">${ringAvatar(me, 'lg')}<div class="grow"><h3>${esc(me.nickname)}</h3><div class="row" style="gap:6px">${lvChip(me)}<span class="small muted">${esc(lv.title)}</span></div></div><b class="prog-pt">${me.points}pt</b></div>
      <div class="bar-track" style="margin-top:12px"><div class="bar-fill" style="width:${Math.round(lv.progress * 100)}%"></div></div>
      <p class="small muted" style="margin:6px 0 0">${next}</p>
      <h2 style="margin:16px 0 0;font-size:.95rem">🎯 今日のミッション</h2>${missionList(m)}
    </section>`;
  }

  function joinCard() {
    return `<section class="card join"><h3>ポイントをためよう</h3>
      <ul><li>登録するだけで +${R.register}pt</li><li>投稿・返信・いいねでポイントが増える</li><li>レベルアップ・ランキングで称号をゲット</li></ul>
      <a class="btn cta block" href="#/register">無料で始める</a><p class="small muted" style="margin:10px 0 0;text-align:center">登録済みの方は<a href="#/login">ログイン</a></p></section>`;
  }

  function rankCard() {
    let rows = S.ranking('month').slice(0, 5);
    let label = '今月のランキング';
    if (!rows.length) { rows = S.ranking('total').slice(0, 5); label = 'ランキング'; }
    const medal = (i) => ['🥇', '🥈', '🥉'][i] || i + 1;
    return `<section class="card"><h2>${ico('trophy')} ${label}</h2>
      ${rows.length ? `<ol class="rank-mini">${rows.map((r, i) => `<li><span class="no">${medal(i)}</span>${avatar(r.user, 'sm')}<span class="grow"><span class="who">${esc(r.user.nickname)}</span></span><span class="pt">${r.points}pt</span></li>`).join('')}</ol>` : '<p class="muted small">まだ誰もいません。</p>'}
      <a class="small" href="#/ranking">ランキングをもっと見る →</a></section>`;
  }

  function viewHome() {
    const me = S.currentUser();
    return `<div class="layout">
      <div class="feed-col">
        <div class="stack">
          ${me ? composerHome(me) : heroGuest()}
          ${me ? `<div class="only-m">${missionStrip()}</div>` : ''}
          ${topicCard('only-m')}
        </div>
        <div class="toolbar" style="margin-top:20px">
          <div class="chips" id="feedChips">${chipsHtml()}</div>
          <div class="controls">
            <div class="seg" id="feedSeg" role="group" aria-label="並び替え">${segHtml()}</div>
            <label class="search">${ico('search')}<input type="search" id="q" placeholder="スレッドを検索" value="${esc(state.q)}" aria-label="スレッドを検索"></label>
          </div>
        </div>
        <div id="threadList">${threadListHtml()}</div>
      </div>
      <aside class="side" aria-label="サイドバー">${me ? progressCard(me) : joinCard()}${topicCard('')}${rankCard()}
        <div class="side-links"><a href="#/rules">ポイントのしくみ</a><a href="#/ranking">ランキング</a></div></aside>
    </div>`;
  }

  // ---------- 画面: スレッド ----------
  function renderBody(text) {
    return nl2br(text).replace(/&gt;&gt;(\d{1,3})/g, (m, n) => `<button type="button" class="anchor" data-act="jump" data-n="${n}">&gt;&gt;${n}</button>`);
  }

  function postHtml(p, idx, thread, me) {
    const n = idx + 1;
    if (p.masked) {
      return `<article class="card post masked" id="post-${n}"><span class="av" style="--h:0;background:var(--line)"></span>
        <div class="post-main"><div class="post-head"><span class="num">#${n}</span></div><p class="muted">この投稿は通報により非表示になっています。</p></div></article>`;
    }
    const isOwner = !!me && me.id === thread.authorId;
    const canBest = isOwner && !p.isOp && p.author.id !== me.id && !p.hidden;
    const canReport = !!me && p.author.id !== me.id && !p.reportedByMe;
    const ownerTag = p.author.id === thread.authorId ? `<span class="owner">${p.isOp ? '投稿主' : 'スレ主'}</span>` : '';
    return `<article class="card post ${p.isBest ? 'best' : ''}" id="post-${n}">
      ${p.isBest ? `<div class="ribbon">${ico('trophy')} ベストアンサー</div>` : ''}
      ${ringAvatar(p.author, 'md')}
      <div class="post-main">
        <div class="post-head">${userLine(p.author)}${ownerTag}<span class="num">#${n}</span>
          ${p.hidden ? '<span class="tag hiddenflag">非表示中(管理者のみ表示)</span>' : ''}<span class="time">${ago(p.createdAt)}</span></div>
        <div class="post-body">${renderBody(p.body)}</div>
        <div class="post-foot">
          <button class="chip-btn like ${p.likedByMe ? 'on' : ''} ${popId === p.id ? 'pop' : ''}" data-act="like" data-id="${esc(p.id)}" aria-pressed="${p.likedByMe}" aria-label="いいね ${p.likeCount}件">${ico('heart')}<span>${p.likeCount}</span></button>
          <button class="chip-btn" data-act="replyTo" data-n="${n}">${ico('reply')}返信</button>
          ${canBest ? `<button class="chip-btn best" data-act="best" data-thread="${esc(thread.id)}" data-id="${esc(p.id)}">${ico('trophy')}${p.isBest ? 'ベストアンサーを取り消す' : 'ベストアンサーに選ぶ'}</button>` : ''}
          <span class="spacer"></span>
          ${p.reportCount ? `<span class="small muted">通報 ${p.reportCount}件</span>` : ''}
          ${canReport ? `<button class="link-btn" data-act="report" data-id="${esc(p.id)}" aria-label="この投稿を通報">${ico('flag')}通報</button>` : ''}
        </div>
      </div>
    </article>`;
  }

  function viewThread(id) {
    const data = S.getThread(id);
    if (!data) return notFound();
    const me = S.currentUser();
    const { thread, posts, author } = data;
    pageTitle = thread.title + ' - ひろば掲示板';
    const replies = posts.filter((p) => !p.isOp && !p.masked).length;
    const likes = posts.reduce((s, p) => s + p.likeCount, 0);
    const box = me
      ? `<form class="card replybox" id="reply-box" data-form="reply">
          <input type="hidden" name="threadId" value="${esc(thread.id)}">
          <div class="replybox-top">${ringAvatar(me, 'md')}
            <div class="field grow"><textarea id="reply-body" name="body" maxlength="2000" data-max="2000" data-min="${R.minLength}" data-keep placeholder="あなたの意見を書いてください(${R.minLength}文字以上でポイント対象)" aria-label="返信" required></textarea>
              <div class="meta"><span class="hint"></span><span class="counter">0 / 2000</span></div></div></div>
          <div class="row between"><span class="small muted">Ctrl+Enter でも送信できます</span>
            <button class="btn cta">返信する<span class="chip-pt">+${R.reply}pt</span></button></div>
        </form>`
      : `<div class="card replybox" id="reply-box"><p style="margin:0 0 12px"><b>返信するにはログインが必要です。</b><br><span class="muted small">登録すると ${R.register}pt もらえます。</span></p>
          <div class="row"><a class="btn cta" href="#/register">無料で始める</a><a class="btn" href="#/login">ログイン</a></div></div>`;
    const others = S.listThreads({ sort: 'hot' }).filter((r) => r.thread.id !== thread.id).slice(0, 3);
    return `<div class="narrow">
      <div class="thread-head">
        <a class="back" href="#/">${ico('back')}一覧に戻る</a>
        <div class="row" style="gap:8px">${catTag(thread.category)}${thread.bestPostId ? `<span class="tag solved">${ico('check')} 解決済み</span>` : ''}</div>
        <h1>${esc(thread.title)}</h1>
        <div class="row" style="gap:6px 14px"><span>${esc(author.nickname)}</span><span>${ico('msg')} ${replies}</span><span>${ico('heart')} ${likes}</span></div>
      </div>
      ${posts.map((p, i) => postHtml(p, i, thread, me)).join('')}
      ${replies === 0 ? `<div class="card nudge" style="margin-top:12px"><span class="big">💬</span><div><b>まだ返信がありません</b><br><span class="small muted">最初の返信者になると +${R.reply}pt。ひと言でも、きっと喜ばれます。</span></div></div>` : ''}
      ${box}
      ${others.length ? `<section class="related"><h2>${ico('spark')} 他のスレッドも見てみよう</h2>${others.map(feedItemHtml).join('')}</section>` : ''}
    </div>`;
  }

  function setupReplyBar() {
    if (io) { io.disconnect(); io = null; }
    const slot = $('#replybar-slot');
    const box = $('#reply-box');
    if (!box || !location.hash.startsWith('#/thread/')) { slot.innerHTML = ''; return; }
    const me = S.currentUser();
    slot.innerHTML = `<button class="replybar hide" id="replybar" data-act="focusReply" aria-label="返信を書く">${ico('chat')}<span>${me ? '返信を書く…' : 'ログインして返信する'}</span>${me ? `<span class="chip-pt">+${R.reply}pt</span>` : ''}</button>`;
    if ('IntersectionObserver' in window) {
      const bar = $('#replybar');
      io = new IntersectionObserver((es) => bar.classList.toggle('hide', es[0].isIntersecting), { threshold: 0.15 });
      io.observe(box); // 返信欄が画面に入ったらバーを隠す(監視開始時にも判定される)
    } else {
      $('#replybar').classList.remove('hide');
    }
  }

  // ---------- 画面: 新規スレッド / ログイン / 登録 ----------
  function viewNew() {
    const me = S.currentUser();
    if (!me) return needLogin('スレッドを立てるにはログインが必要です。');
    pageTitle = 'スレッドを立てる - ひろば掲示板';
    const d = getDraft();
    return `<div class="narrow stack">
      <div class="page-h"><h1>スレッドを立てる</h1><p>あなたの一言から、会話が始まります。</p></div>
      <form class="card stack" data-form="newthread" autocomplete="off">
        ${catPills(draftCategory())}
        <div class="field"><label for="nt-title">タイトル</label>
          <input type="text" id="nt-title" name="title" maxlength="60" data-max="60" value="${esc(d.title || '')}" placeholder="例:在宅でできる副業、何から始めるのがいい?" required>
          <div class="meta"><span></span><span class="counter">0 / 60</span></div></div>
        <div class="field"><label for="nt-body">本文</label>
          <textarea id="nt-body" name="body" maxlength="2000" data-max="2000" data-min="${R.minLength}" data-keep placeholder="状況や、みんなに聞きたいことを書いてみましょう" required>${esc(d.body || '')}</textarea>
          <div class="meta"><span class="hint"></span><span class="counter">0 / 2000</span></div></div>
        <p class="small muted" style="margin:0">誹謗中傷・個人情報・宣伝はご遠慮ください。下書きは自動で保存されます。</p>
        <div class="row between"><a class="btn ghost" href="#/">キャンセル</a><button class="btn cta lg">投稿する<span class="chip-pt">+${R.thread}pt</span></button></div>
      </form>
      ${topicCard('')}
    </div>`;
  }

  function authSide(title) {
    return `<aside class="card auth-side"><h2>${title}</h2>
      <ul><li><b>+${R.register}pt</b>登録ボーナス</li><li><b>+${R.thread}pt</b>スレッドを立てる</li><li><b>+${R.reply}pt</b>返信する</li><li><b>+${R.best}pt</b>ベストアンサー</li></ul></aside>`;
  }

  function viewLogin() {
    pageTitle = 'ログイン - ひろば掲示板';
    return `<div class="auth">
      ${authSide('おかえりなさい。<br>今日もひとこと、どうですか?')}
      <form class="card stack auth-form" data-form="login">
        <h1>ログイン</h1>
        ${state.notice ? `<div class="notice" role="status">✉️ ${esc(state.notice)}</div>` : ''}
        <div class="field"><label for="li-email">メールアドレス</label><input type="email" id="li-email" name="email" autocomplete="email" required></div>
        <div class="field"><label for="li-pw">パスワード</label><input type="password" id="li-pw" name="password" autocomplete="current-password" required></div>
        <button class="btn cta lg block">ログイン</button>
        <p class="small muted" style="margin:0;text-align:center">はじめての方は<a href="#/register">新規登録</a>(+${R.register}pt)</p>
      </form></div>`;
  }

  function viewRegister() {
    pageTitle = '新規登録 - ひろば掲示板';
    return `<div class="auth">
      ${authSide('登録して、<br>ポイントをためよう。')}
      <form class="card stack auth-form" data-form="register">
        <h1>新規登録</h1>
        <div class="field"><label for="rg-email">メールアドレス</label><input type="email" id="rg-email" name="email" autocomplete="email" required></div>
        <div class="field"><label for="rg-nick">ニックネーム(2〜16文字・公開されます)</label><input type="text" id="rg-nick" name="nickname" maxlength="16" autocomplete="nickname" required></div>
        <div class="field"><label for="rg-pw">パスワード(8文字以上)</label><input type="password" id="rg-pw" name="password" autocomplete="new-password" minlength="8" required></div>
        <button class="btn cta lg block">登録して +${R.register}pt もらう</button>
        <p class="small muted" style="margin:0">試作版のため確認メールは送信されません。メールアドレスは公開されず、この端末にのみ保存されます。すでに登録済みの方は<a href="#/login">ログイン</a>へ。</p>
      </form></div>`;
  }

  // ---------- 画面: マイページ ----------
  function viewMe() {
    const prof = S.myProfile();
    if (!prof) return needLogin('マイページを見るにはログインが必要です。');
    pageTitle = 'マイページ - ひろば掲示板';
    const { user, stats, badges, history, threads } = prof;
    const lv = user.level;
    const nextText = lv.next ? `次のLv.${lv.next.lv}「${esc(lv.next.title)}」まで あと ${lv.next.min - user.points}pt` : '最高レベルに到達しました!';
    return `<div class="narrow stack">
      <section class="card me-hero">
        <div class="me-top">${ringAvatar(user, 'xl')}<div><h1>${esc(user.nickname)}</h1>
          <div class="me-sub">${lvChip(user)}<span>${esc(lv.title)}${user.isAdmin ? ' ・ 管理者' : ''}</span></div></div></div>
        <div class="me-pt"><b>${user.points}</b><span>pt</span></div>
        <div class="bar-track" role="progressbar" aria-valuenow="${Math.round(lv.progress * 100)}" aria-valuemin="0" aria-valuemax="100"><div class="bar-fill" style="width:${Math.round(lv.progress * 100)}%"></div></div>
        <p>${nextText}</p>
      </section>
      <section class="card"><h2>🎯 今日のミッション</h2>${missionList(S.missions())}</section>
      <section class="card stats">
        <div><b>${stats.posts}</b><span>投稿数</span></div><div><b>${stats.threads}</b><span>立てたスレッド</span></div>
        <div><b>${stats.likes}</b><span>もらったいいね</span></div><div><b>${stats.best}</b><span>ベストアンサー</span></div>
      </section>
      <section class="card"><h2>バッジ</h2>
        <div class="badges">${badges.map((b) => `<div class="badge ${b.earned ? '' : 'off'}"><span class="ic">${b.icon}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`).join('')}</div>
      </section>
      <section class="card"><h2>ポイント履歴(直近20件)</h2>
        ${history.length ? `<ul class="list">${history.map((h) => `<li><span class="grow">${esc(h.reason)}<br><span class="small muted">${ago(h.at)}</span></span><span class="amt ${h.amount > 0 ? 'plus' : 'minus'}">${h.amount > 0 ? '+' : ''}${h.amount}pt</span></li>`).join('')}</ul>` : '<p class="muted">まだ履歴がありません。</p>'}
      </section>
      <section class="card"><h2>自分が立てたスレッド</h2>
        ${threads.length ? `<ul class="list">${threads.map((t) => `<li><a class="grow" href="#/thread/${esc(t.id)}">${esc(t.title)}</a><span class="small muted">${ago(t.createdAt)}</span></li>`).join('')}</ul>` : '<p class="muted">まだスレッドを立てていません。<a href="#/new">最初の1本を立てる →</a></p>'}
      </section>
      <div class="row" style="justify-content:center">
        ${user.isAdmin ? `<a class="btn" href="#/admin">${ico('shield')}管理ページ</a>` : ''}
        <button class="btn ghost" data-act="logout">${ico('logout')}ログアウト</button>
      </div>
    </div>`;
  }

  // ---------- 画面: ランキング / ルール ----------
  function viewRanking() {
    pageTitle = 'ランキング - ひろば掲示板';
    const me = S.currentUser();
    const rows = S.ranking(state.rank);
    const top = rows.slice(0, 3);
    const rest = rows.slice(3);
    const medal = ['🥇', '🥈', '🥉'];
    const podium = top.length ? `<div class="podium">${[1, 0, 2].map((i) => {
      const r = top[i];
      if (!r) return '<div class="pod"></div>';
      return `<div class="pod p${i + 1}"><span class="crown">${medal[i]}</span>${ringAvatar(r.user, i === 0 ? 'lg' : 'md')}<div class="pod-name">${esc(r.user.nickname)}</div><div class="pod-pt">${r.points}pt</div><div class="step">${i + 1}</div></div>`;
    }).join('')}</div>` : '';
    const seg = [['total', '総合'], ['month', '今月']].map(([k, l]) => `<button class="${state.rank === k ? 'on' : ''}" data-act="rank" data-val="${k}">${l}</button>`).join('');
    return `<div class="narrow">
      <div class="page-h"><h1>${ico('trophy')} ランキング</h1><p>投稿・返信・いいねでポイントをためて、上位を目指そう。</p></div>
      <div class="seg wide" role="group" aria-label="期間">${seg}</div>
      ${rows.length ? podium : ''}
      <section class="card">${rows.length
        ? (rest.length ? `<ol class="list">${rest.map((r, i) => `<li class="${me && me.id === r.user.id ? 'me-row' : ''}"><span class="rank-no">${i + 4}</span>${avatar(r.user, 'md')}<span class="grow">${userLine(r.user)}</span><span class="pt">${r.points}pt</span></li>`).join('')}</ol>` : '<p class="muted" style="margin:0;text-align:center">4位以降はまだいません。あなたも参加しよう!</p>')
        : '<div class="empty"><span class="big">🏁</span>まだランキングに載るユーザーがいません。<br>最初のランカーになりませんか?</div>'}</section>
      ${me ? '' : `<div class="card nudge" style="margin-top:14px"><span class="big">🚀</span><div class="grow"><b>あなたもランキングに参加しよう</b><br><span class="small muted">登録で +${R.register}pt からスタート。</span></div><a class="btn cta sm" href="#/register">無料で始める</a></div>`}
    </div>`;
  }

  function viewRules() {
    pageTitle = 'ポイントのしくみ - ひろば掲示板';
    const me = S.currentUser();
    const tile = (e, l, v) => `<div class="tile"><span class="e">${e}</span><b>+${v}pt</b><span>${l}</span></div>`;
    return `<div class="narrow stack">
      <div class="page-h"><h1>${ico('gift')} ポイントのしくみ</h1><p>書くほど、話すほど、ポイントがたまります。</p></div>
      <section class="card"><h2>ポイントのためかた</h2>
        <div class="tiles">
          ${tile('✨', '新規登録', R.register)}${tile('🎁', 'ログイン(毎日)', R.daily)}${tile('✏️', 'スレッドを立てる', R.thread)}${tile('💬', '返信する', R.reply)}
          ${tile('❤️', 'いいねをもらう', R.likeReceived)}${tile('🏆', 'ベストアンサー', R.best)}${tile('🎯', 'その日スレッド+返信', R.missionBonus)}
        </div></section>
      <section class="card"><h2>レベル</h2>
        <ul class="ladder">${S.LEVELS.map((l) => `<li class="${me && me.level.lv === l.lv ? 'now' : ''}"><span class="lv lvn">Lv.${l.lv}</span><span class="grow"><b>${esc(l.title)}</b></span><span class="pt">${l.min}pt〜</span></li>`).join('')}</ul></section>
      <section class="card"><h2>みんなが気持ちよく使うために</h2>
        <ul class="fair">
          <li>投稿・返信のポイントは1日に最大 ${R.dailyPostCap}pt までです。</li>
          <li>${R.minLength}文字未満の投稿はポイント対象外です。</li>
          <li>自分の投稿への「いいね」・ベストアンサーはできません。</li>
          <li>連続投稿は ${R.cooldownSec}秒 あけてください。</li>
          <li>通報が ${R.reportHideAt}件 集まった投稿は、確認のため自動で非表示になります。</li>
          <li>管理者に非表示にされた投稿は -${R.hiddenPenalty}pt になります。</li>
        </ul></section>
    </div>`;
  }

  // ---------- 画面: 管理 ----------
  function viewAdmin() {
    const me = S.currentUser();
    if (!me || !me.isAdmin) return needLogin('このページは管理者のみ利用できます。');
    pageTitle = '管理 - ひろば掲示板';
    const list = S.listReported();
    const items = list.map((p) => `
      <li class="admin-item">
        <div class="row"><a href="#/thread/${esc(p.threadId)}">${esc(p.threadTitle)}</a>
          ${p.hidden ? `<span class="tag hiddenflag">${p.autoHidden ? '自動非表示' : '非表示'}</span>` : ''}
          <span class="small muted">通報 ${p.reasons.length}件</span></div>
        <p class="small" style="margin:6px 0">${esc(p.author.nickname)}:${esc(p.body.slice(0, 140))}${p.body.length > 140 ? '…' : ''}</p>
        <p class="small muted">理由:${p.reasons.length ? esc(p.reasons.join(' / ')) : 'なし'}</p>
        <div class="row">
          <button class="btn sm danger" data-act="adminHide" data-id="${esc(p.id)}" ${p.hidden && !p.autoHidden ? 'disabled' : ''}>非表示にして確定(-${R.hiddenPenalty}pt)</button>
          <button class="btn sm" data-act="adminRestore" data-id="${esc(p.id)}">問題なし(復元)</button>
        </div>
      </li>`).join('');
    return `<div class="narrow stack">
      <div class="page-h"><h1>${ico('shield')} 管理</h1></div>
      <section class="card"><h2>通報された投稿</h2>
        ${items ? `<ul class="list">${items}</ul>` : '<p class="muted" style="margin:0">通報された投稿はありません。</p>'}
      </section>
      <section class="card"><h2>NGワード</h2>
        <form data-form="ng" class="stack">
          <div class="field"><label for="ng-words">1行に1語(カンマ区切りも可)</label>
            <textarea id="ng-words" name="words" style="min-height:100px">${esc(S.getNgWords().join('\n'))}</textarea></div>
          <button class="btn brand">保存する</button>
        </form>
      </section>
    </div>`;
  }

  // ---------- 画面: 未設定・読み込み中・エラー ----------
  function viewSetup() {
    pageTitle = '接続設定が必要です - ひろば掲示板';
    const why = S.configProblem === 'library'
      ? 'Supabase のライブラリ(vendor/supabase-js.umd.js)を読み込めませんでした。'
      : 'config.js に Supabase の接続情報(Project URL と anon キー)が設定されていません。';
    return `<div class="card narrow empty"><span class="big">🔧</span>
      <h2 style="margin-bottom:8px">Supabase の設定が必要です</h2>
      <p>${why}</p>
      <p class="small muted">手順は <b>supabase/セットアップ手順.md</b> を参照してください。</p></div>`;
  }
  const loadingHtml = () => '<div class="loading" role="status" aria-live="polite"><span class="spinner"></span>読み込み中…</div>';
  function loadErrorHtml(e) {
    return `<div class="card narrow empty"><span class="big">📡</span><p>${esc(e.message || e)}</p>
      <button class="btn brand" data-act="retry">もう一度読み込む</button></div>`;
  }

  // ---------- ルーター ----------
  let renderToken = 0;
  async function render(keepScroll) {
    const token = ++renderToken;
    const hash = location.hash || '#/';
    const seg = hash.slice(1).split('/').filter(Boolean);
    pageTitle = 'ひろば掲示板';

    if (!S.ready) {
      renderHeader('');
      app.innerHTML = viewSetup();
      document.title = pageTitle;
      return;
    }

    // ページ移動のときだけ、少し待たされたら「読み込み中」を出す(いいね等の再描画ではちらつかせない)
    const loaderTimer = keepScroll ? 0 : setTimeout(() => {
      if (token === renderToken) { app.classList.remove('enter'); app.innerHTML = loadingHtml(); }
    }, 250);
    let loadError = null;
    try { await S.load(seg); } catch (e) { loadError = e; }
    clearTimeout(loaderTimer);
    if (token !== renderToken) return; // もっと新しい描画が始まっている

    // 再描画で入力中の内容(返信・本文)が消えないよう退避する
    const kept = {};
    $$('[data-keep]', app).forEach((el) => { if (el.id && el.value) kept[el.id] = el.value; });

    let html;
    try {
      if (loadError) throw loadError;
      switch (seg[0]) {
        case undefined: html = viewHome(); break;
        case 'thread': html = viewThread(seg[1]); break;
        case 'new': html = viewNew(); break;
        case 'login': html = viewLogin(); break;
        case 'register': html = viewRegister(); break;
        case 'me': html = viewMe(); break;
        case 'ranking': html = viewRanking(); break;
        case 'rules': html = viewRules(); break;
        case 'admin': html = viewAdmin(); break;
        default: html = notFound();
      }
    } catch (e) {
      html = loadError ? loadErrorHtml(e)
        : `<div class="card narrow empty"><span class="big">🙇</span>表示中にエラーが起きました。<br>${esc(e.message || e)}</div>`;
    }
    renderHeader(seg[0] || '');
    app.innerHTML = html;
    app.classList.toggle('enter', !keepScroll);
    document.title = pageTitle;

    Object.keys(kept).forEach((id) => { const el = document.getElementById(id); if (el && !el.value) el.value = kept[id]; });
    $$('[data-max]', app).forEach(updateCounter);
    setupReplyBar();
    popId = null;
    if (!keepScroll) window.scrollTo(0, 0);
  }

  function go(hash) {
    if (location.hash === hash) return render(false);
    location.hash = hash;
    return Promise.resolve();
  }

  function updateCounter(t) {
    const f = t.closest('.field');
    if (!f) return;
    const c = f.querySelector('.counter');
    if (c) c.textContent = t.value.length + ' / ' + t.dataset.max;
    const h = f.querySelector('.hint');
    if (h && t.dataset.min) {
      const len = t.value.trim().length;
      const left = Number(t.dataset.min) - len;
      h.textContent = len === 0 ? '' : left > 0 ? 'あと' + left + '文字でポイント対象' : '✓ ポイント対象です';
      h.classList.toggle('ok', len > 0 && left <= 0);
    }
  }

  // ---------- モーダル ----------
  function openModal(inner) {
    $('#modal').innerHTML = `<div class="modal-back" data-act="closeBackdrop"><div class="modal" role="dialog" aria-modal="true">${inner}</div></div>`;
    const first = $('#modal input, #modal textarea, #modal button');
    if (first) first.focus();
  }
  function closeModal() { $('#modal').innerHTML = ''; }

  function openReport(postId) {
    const reasons = ['誹謗中傷・攻撃的な内容', 'スパム・宣伝', '個人情報の掲載', 'その他の不適切な内容'];
    openModal(`<h2>この投稿を通報する</h2>
      <form data-form="report" class="stack">
        <input type="hidden" name="postId" value="${esc(postId)}">
        <div>${reasons.map((r, i) => `<label class="radio"><input type="radio" name="reason" value="${esc(r)}" ${i === 0 ? 'checked' : ''}>${esc(r)}</label>`).join('')}</div>
        <div class="row"><button class="btn danger">通報する</button><button type="button" class="btn ghost" data-act="closeModal">キャンセル</button></div>
      </form>`);
  }

  // ---------- 操作(クリック) ----------
  function updateFeed() {
    $('#feedChips').innerHTML = chipsHtml();
    $('#feedSeg').innerHTML = segHtml();
    $('#threadList').innerHTML = threadListHtml();
  }

  const actions = {
    cat(el) { state.cat = el.dataset.val; updateFeed(); },
    sort(el) { state.sort = el.dataset.val; updateFeed(); },
    rank(el) { state.rank = el.dataset.val; return render(true); },
    async logout() { await S.logout(); toast('ログアウトしました'); await go('#/'); },
    retry() { return render(false); },
    async like(el) {
      const liked = await S.toggleLike(el.dataset.id);
      popId = liked ? el.dataset.id : null;
      await render(true);
    },
    async best(el) {
      const on = await S.setBest(el.dataset.thread, el.dataset.id);
      toast(on ? 'ベストアンサーに選びました' : 'ベストアンサーを取り消しました', '', on ? '🏆' : '');
      await render(true);
    },
    report(el) {
      if (!S.currentUser()) throw new Error('ログインが必要です');
      openReport(el.dataset.id);
    },
    useTopic() {
      const t = S.todayTopic();
      setDraft({ category: t.category, title: t.title, body: '' });
      go('#/new');
      setTimeout(() => { const b = $('#nt-body'); if (b) b.focus({ preventScroll: true }); }, 120);
    },
    replyTo(el) {
      if (!S.currentUser()) throw new Error('返信するにはログインが必要です');
      const ta = $('#reply-body');
      if (!ta) return;
      const tag = '>>' + el.dataset.n + ' ';
      if (!ta.value.startsWith(tag)) ta.value = tag + ta.value;
      updateCounter(ta);
      ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
      ta.focus({ preventScroll: true });
    },
    focusReply() {
      if (!S.currentUser()) { go('#/login'); return; }
      const ta = $('#reply-body');
      if (!ta) return;
      ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
      ta.focus({ preventScroll: true });
    },
    jump(el) {
      const target = document.getElementById('post-' + el.dataset.n);
      if (!target) { toast('その番号の投稿はありません'); return; }
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.remove('flash');
      void target.offsetWidth; // アニメーションを最初から再生するため
      target.classList.add('flash');
    },
    closeModal() { closeModal(); },
    closeBackdrop(el, e) { if (e.target === el) closeModal(); },
    closeCelebrate(el, e) { if (e.target === el || el.dataset.force) { clearTimeout(celebrate.t); $('#celebrate').innerHTML = ''; } },
    async adminHide(el) { await S.hidePost(el.dataset.id); toast('非表示にしました'); await render(true); },
    async adminRestore(el) { await S.restorePost(el.dataset.id); toast('復元しました'); await render(true); },
  };

  // ---------- 操作(フォーム送信) ----------
  const forms = {
    async login(fd) {
      await S.login(fd.get('email'), fd.get('password'));
      state.notice = '';
      toast('ログインしました', '', '👋');
      await go('#/');
    },
    async register(fd) {
      const r = await S.register({ email: fd.get('email'), nickname: fd.get('nickname'), password: fd.get('password') });
      if (r.confirmed) {
        toast('登録しました。ようこそ!', '', '🎉');
        await go('#/');
      } else {
        // メール確認が必要な設定のとき: 確認メールのリンクを開いてからログインしてもらう
        state.notice = '確認メールを送信しました。メール内のリンクを開いて登録を完了してから、ログインしてください。(届かない場合は迷惑メールフォルダもご確認ください)';
        await go('#/login');
      }
    },
    async newthread(fd) {
      const r = await S.createThread({ category: fd.get('category'), title: fd.get('title'), body: fd.get('body') });
      clearDraft();
      if (r.note) toast(r.note);
      await go('#/thread/' + r.thread.id);
    },
    async reply(fd, form) {
      const r = await S.createReply(fd.get('threadId'), fd.get('body'));
      if (r.note) toast(r.note);
      form.reset();
      await render(true);
      const last = app.querySelector('.post:last-of-type');
      if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    async report(fd) {
      await S.report(fd.get('postId'), fd.get('reason'));
      closeModal();
      toast('通報しました。ご協力ありがとうございます');
      await render(true);
    },
    async ng(fd) {
      await S.setNgWords(fd.get('words'));
      toast('NGワードを保存しました');
      await render(true);
    },
  };

  async function run(fn) {
    try { await fn(); } catch (e) { toast(e.message || String(e), 'err'); }
    flush();
    renderHeader(location.hash.slice(1).split('/').filter(Boolean)[0] || '');
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !actions[el.dataset.act]) return;
    // 通信中の二重クリック(いいねが2回押される等)を防ぐ
    if (el.dataset.busy) return;
    el.dataset.busy = '1';
    run(() => actions[el.dataset.act](el, e)).finally(() => { delete el.dataset.busy; });
  });

  document.addEventListener('submit', (e) => {
    const form = e.target;
    const name = form.dataset && form.dataset.form;
    if (!name || !forms[name]) return;
    e.preventDefault();
    const btn = form.querySelector('button:not([type=button])');
    if (btn) btn.disabled = true;
    run(() => forms[name](new FormData(form), form)).finally(() => { if (btn) btn.disabled = false; });
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'q') {
      state.q = t.value;
      $('#threadList').innerHTML = threadListHtml();
      return;
    }
    if (t.dataset && t.dataset.max) updateCounter(t);
    const form = t.closest && t.closest('form[data-form=newthread]');
    if (form) saveDraftFrom(form);
  });

  document.addEventListener('change', (e) => {
    const form = e.target.closest && e.target.closest('form[data-form=newthread]');
    if (form) saveDraftFrom(form);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); $('#celebrate').innerHTML = ''; }
    // Ctrl/Cmd + Enter で送信
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.tagName === 'TEXTAREA' && e.target.form) {
      e.preventDefault();
      e.target.form.requestSubmit();
    }
  });

  window.addEventListener('hashchange', () => {
    closeModal();
    render(false);
  });

  // ---------- 起動 ----------
  (async function boot() {
    // メール確認から戻ったときの ?code=... はライブラリが処理するので、URL からは消しておく
    if (/[?&](code|error|error_description)=/.test(location.search)) {
      history.replaceState(null, '', location.pathname + (location.hash || '#/'));
    }
    renderHeader('');
    app.innerHTML = loadingHtml();
    if (S.ready) {
      try {
        await S.init();
        await S.dailyBonus();
      } catch (e) {
        toast(e.message || String(e), 'err');
      }
      // 別のタブでログイン/ログアウトしたときに追従する
      S.onAuthChange(() => render(true));
    }
    await render(false);
    flush();
    renderHeader(location.hash.slice(1).split('/').filter(Boolean)[0] || '');
  })();
})();
