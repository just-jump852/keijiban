/*
 * store.js — データ層(localStorage)
 *
 * 画面(app.js)はこのファイルの Store だけを通してデータを読み書きする。
 * 将来 Supabase / Firebase に載せ替えるときは、このファイルの中身を
 * API 呼び出しに置き換える(その際は各関数を async にする)。
 *
 * 注意: 試作版のため、アカウントも投稿もこのブラウザの中にだけ保存される。
 *       パスワードはハッシュ化して保存するが、本番の認証の代わりにはならない。
 */
(function (global) {
  'use strict';

  const KEY = 'keijiban_v1';
  const SESSION_KEY = 'keijiban_session_v1';

  const CATEGORIES = ['雑談', '相談・質問', '仕事・副業', '健康・リハビリ', '趣味', '意見交換'];

  const LEVELS = [
    { lv: 1, min: 0, title: 'はじめの一歩' },
    { lv: 2, min: 20, title: 'おしゃべり好き' },
    { lv: 3, min: 60, title: '常連さん' },
    { lv: 4, min: 120, title: '語り部' },
    { lv: 5, min: 220, title: 'ご意見番' },
    { lv: 6, min: 380, title: '名物投稿者' },
    { lv: 7, min: 650, title: '伝説の書き手' },
    { lv: 8, min: 1000, title: '殿堂入り' },
  ];

  // ポイントのルール(画面の「ポイントのしくみ」にもここの値が表示される)
  const RULES = {
    register: 10, // 新規登録
    daily: 1, // 1日1回のログインボーナス
    thread: 5, // スレッドを立てる
    reply: 2, // 返信する
    likeReceived: 1, // いいねをもらう
    best: 10, // ベストアンサーに選ばれる
    hiddenPenalty: 10, // 管理者に非表示にされた投稿の減点
    dailyPostCap: 30, // 「投稿」で1日にためられる上限
    minLength: 10, // この文字数未満の投稿はポイント対象外
    cooldownSec: 20, // 連続投稿の間隔
    reportHideAt: 3, // 通報がこの数に達したら自動で非表示
    missionBonus: 3, // 同じ日に「スレッドを立てる」と「返信する」の両方をやったときのボーナス
  };

  const BADGES = [
    { id: 'first', icon: '🌱', name: '初投稿', desc: '初めて投稿した', test: (s) => s.posts >= 1 },
    { id: 'thr5', icon: '🧵', name: 'スレ立て名人', desc: 'スレッドを5本立てた', test: (s) => s.threads >= 5 },
    { id: 'p10', icon: '📝', name: '10回投稿', desc: '10回投稿した', test: (s) => s.posts >= 10 },
    { id: 'p50', icon: '🔥', name: '50回投稿', desc: '50回投稿した', test: (s) => s.posts >= 50 },
    { id: 'like10', icon: '❤️', name: '人気者', desc: 'いいねを10個もらった', test: (s) => s.likes >= 10 },
    { id: 'like50', icon: '💖', name: 'みんなのアイドル', desc: 'いいねを50個もらった', test: (s) => s.likes >= 50 },
    { id: 'best1', icon: '🏆', name: '頼れる回答者', desc: 'ベストアンサーに選ばれた', test: (s) => s.best >= 1 },
    { id: 'best5', icon: '👑', name: '名回答者', desc: 'ベストアンサーに5回選ばれた', test: (s) => s.best >= 5 },
  ];

  const DEFAULT_NG = ['死ね', '殺す', '出会い系', 'カジノ'];

  // 「今日のお題」— 何を書こうか迷う人が、ワンタップで投稿を始められるようにする
  const DAILY_TOPICS = [
    { category: '雑談', title: '最近ちょっと嬉しかったこと、教えてください', hint: '小さなことでOK。朝ごはんが美味しかった、でも!' },
    { category: '雑談', title: '休日の過ごし方、みなさんはどうしていますか?', hint: '出かける派?家でのんびり派?' },
    { category: '健康・リハビリ', title: '寝る前に続けている習慣はありますか?', hint: 'ストレッチ、読書、白湯など。ぐっすり眠るコツも。' },
    { category: '仕事・副業', title: '仕事や作業を効率化するために、最近やってみたことは?', hint: 'ツール、時間の使い方、ちょっとした工夫など。' },
    { category: '趣味', title: '最近ハマっているもの、ジャンル問わず教えて!', hint: '映画、料理、ゲーム、散歩…なんでも。' },
    { category: '意見交換', title: '「続ける」コツって何だと思いますか?', hint: '三日坊主を乗り越えた経験があればぜひ。' },
    { category: '相談・質問', title: '今、ちょっと悩んでいること、相談してみませんか?', hint: '誰かの経験が、ヒントになるかもしれません。' },
    { category: '雑談', title: '子どもの頃に好きだった食べ物は?', hint: '思い出話もお待ちしています。' },
    { category: '健康・リハビリ', title: 'デスクワークの肩こり・腰痛対策、何をしていますか?', hint: '続けやすい方法を教え合いましょう。' },
    { category: '意見交換', title: 'これからの時代、どんな力が大事になると思いますか?', hint: 'あなたの考えを聞かせてください。' },
  ];

  // ---------- 小さな道具 ----------
  const now = () => Date.now();
  const pad = (n) => String(n).padStart(2, '0');
  function dayKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  const monthKey = (ts) => dayKey(ts).slice(0, 7);
  const uid = (p) => p + now().toString(36) + Math.random().toString(36).slice(2, 7);

  async function hashPassword(pw, salt) {
    const data = salt + ':' + pw;
    if (global.crypto && global.crypto.subtle) {
      const buf = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 5381; // crypto が使えない環境用の簡易ハッシュ
    for (let i = 0; i < data.length; i++) h = ((h << 5) + h) ^ data.charCodeAt(i);
    return 'f' + (h >>> 0).toString(16);
  }

  // ---------- 保存 ----------
  let db = null;
  let notices = [];
  let memSession = null;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* 読めなければ初期データを使う */ }
    return null;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* 保存できない環境では今回のみ有効 */ }
  }
  function reload() {
    const d = load();
    if (d) db = d;
  }

  function sessionId() {
    try { return localStorage.getItem(SESSION_KEY) || memSession; } catch (e) { return memSession; }
  }
  function setSession(id) {
    memSession = id;
    try {
      if (id) localStorage.setItem(SESSION_KEY, id);
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* 無視 */ }
  }

  // ---------- ユーザー・レベル ----------
  const userRaw = (id) => db.users.find((u) => u.id === id) || null;
  function meRaw() {
    const id = sessionId();
    return id ? userRaw(id) : null;
  }
  function requireUser() {
    const u = meRaw();
    if (!u) throw new Error('ログインが必要です');
    return u;
  }
  function requireAdmin() {
    const u = requireUser();
    if (!u.isAdmin) throw new Error('管理者のみ操作できます');
    return u;
  }

  function levelOf(points) {
    let cur = LEVELS[0];
    for (const l of LEVELS) if (points >= l.min) cur = l;
    const next = LEVELS.find((l) => l.min > points) || null;
    const progress = next ? (points - cur.min) / (next.min - cur.min) : 1;
    return { lv: cur.lv, title: cur.title, min: cur.min, next, progress };
  }

  function publicUser(id) {
    const u = userRaw(id);
    if (!u) return { id, nickname: '(退会したユーザー)', points: 0, level: levelOf(0), isAdmin: false };
    return { id: u.id, nickname: u.nickname, points: u.points, level: levelOf(u.points), isAdmin: !!u.isAdmin };
  }

  function currentUser() {
    const u = meRaw();
    if (!u) return null;
    return Object.assign(publicUser(u.id), { email: u.email, createdAt: u.createdAt });
  }

  // ポイント加減算。実際に増減した量を返す(0 未満にはならない)
  function addPoints(user, amount, reason) {
    const next = Math.max(0, user.points + amount);
    const delta = next - user.points;
    if (!delta) return 0;
    const before = levelOf(user.points).lv;
    user.points = next;
    db.log.push({ userId: user.id, amount: delta, reason, at: now() });
    if (db.log.length > 3000) db.log.splice(0, db.log.length - 3000);
    if (user.id === sessionId()) {
      notices.push({ type: 'points', amount: delta, reason });
      const after = levelOf(user.points);
      if (after.lv > before) notices.push({ type: 'levelup', lv: after.lv, title: after.title });
    }
    return delta;
  }

  // 投稿ポイント: 短すぎる投稿は対象外、1日の上限あり。付与した量と補足メッセージを返す
  function awardForPost(user, base, body, reason) {
    if (body.replace(/\s/g, '').length < RULES.minLength) {
      return { awarded: 0, note: RULES.minLength + '文字未満の投稿はポイント対象外です' };
    }
    const t = dayKey(now());
    if (!user.postPt || user.postPt.date !== t) user.postPt = { date: t, amount: 0 };
    const give = Math.min(base, Math.max(0, RULES.dailyPostCap - user.postPt.amount));
    if (give <= 0) return { awarded: 0, note: '本日の投稿ポイント上限に達しました(明日またためられます)' };
    user.postPt.amount += give;
    addPoints(user, give, reason);
    return { awarded: give, note: '' };
  }

  function claimDaily(user) {
    const t = dayKey(now());
    if (user.lastBonusDate === t) return false;
    user.lastBonusDate = t;
    addPoints(user, RULES.daily, 'ログインボーナス');
    return true;
  }

  // ---------- 今日のミッション ----------
  function dailyOf(user) {
    const t = dayKey(now());
    if (!user.daily || user.daily.date !== t) user.daily = { date: t, thread: false, reply: false, bonus: false };
    return user.daily;
  }
  // スレッド・返信の両方をやった日はボーナス
  function markMission(user, kind) {
    const d = dailyOf(user);
    d[kind] = true;
    if (d.thread && d.reply && !d.bonus) {
      d.bonus = true;
      addPoints(user, RULES.missionBonus, '今日のミッション達成ボーナス');
    }
  }
  function missions() {
    const u = meRaw();
    if (!u) return null;
    const d = dailyOf(u);
    const used = u.postPt && u.postPt.date === d.date ? u.postPt.amount : 0;
    return {
      items: [
        { id: 'login', label: '今日ログインする', pts: RULES.daily, done: true },
        { id: 'reply', label: '誰かの投稿に返信する', pts: RULES.reply, done: d.reply },
        { id: 'thread', label: 'スレッドを立てる', pts: RULES.thread, done: d.thread },
      ],
      bonus: RULES.missionBonus,
      bonusDone: d.bonus,
      postPt: { used, cap: RULES.dailyPostCap },
    };
  }
  function todayTopic() {
    const d = new Date();
    const n = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    return DAILY_TOPICS[n % DAILY_TOPICS.length];
  }

  // ---------- 入力チェック ----------
  function findNg(text) {
    const norm = String(text).replace(/\s/g, '').toLowerCase();
    return db.ngWords.find((w) => w && norm.includes(w.toLowerCase())) || null;
  }
  function cleanText(text, label, min, max) {
    const t = String(text || '').replace(/\r\n/g, '\n').trim();
    if (t.length < min) throw new Error(label + 'を入力してください');
    if (t.length > max) throw new Error(label + 'は' + max + '文字以内で入力してください');
    const ng = findNg(t);
    if (ng) throw new Error(label + 'に使用できない言葉「' + ng + '」が含まれています');
    return t;
  }
  function checkCooldown(user) {
    const wait = Math.ceil((user.lastPostAt + RULES.cooldownSec * 1000 - now()) / 1000);
    if (wait > 0) throw new Error('連続投稿を防ぐため、あと' + wait + '秒お待ちください');
  }

  // ---------- アカウント ----------
  async function register(input) {
    const email = String(input.email || '').trim().toLowerCase();
    const nickname = String(input.nickname || '').trim();
    const password = String(input.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('メールアドレスの形式が正しくありません');
    if (nickname.length < 2 || nickname.length > 16) throw new Error('ニックネームは2〜16文字で入力してください');
    if (findNg(nickname)) throw new Error('このニックネームは使用できません');
    if (password.length < 8) throw new Error('パスワードは8文字以上で入力してください');
    if (db.users.some((u) => u.email === email)) throw new Error('このメールアドレスは既に登録されています');
    if (db.users.some((u) => u.nickname.toLowerCase() === nickname.toLowerCase())) {
      throw new Error('このニックネームは既に使われています');
    }
    const salt = uid('s');
    const user = {
      id: uid('u'),
      email,
      nickname,
      salt,
      hash: await hashPassword(password, salt),
      points: 0,
      createdAt: now(),
      lastBonusDate: dayKey(now()), // 登録日はログインボーナス済みとして扱う
      lastPostAt: 0,
      postPt: null,
      demo: false,
      isAdmin: !db.users.some((u) => !u.demo), // 最初に登録した本人を管理者にする
    };
    db.users.push(user);
    setSession(user.id);
    addPoints(user, RULES.register, '新規登録ボーナス');
    save();
    return currentUser();
  }

  async function login(emailIn, password) {
    const email = String(emailIn || '').trim().toLowerCase();
    const u = db.users.find((x) => x.email === email && !x.demo);
    if (!u || u.hash !== (await hashPassword(String(password || ''), u.salt))) {
      throw new Error('メールアドレスまたはパスワードが違います');
    }
    setSession(u.id);
    claimDaily(u);
    save();
    return currentUser();
  }

  function logout() { setSession(null); }

  // 起動時に呼ぶ。ログイン中なら1日1回のボーナスを付与
  function dailyBonus() {
    const u = meRaw();
    if (!u) return false;
    const got = claimDaily(u);
    if (got) save();
    return got;
  }

  // ---------- 投稿 ----------
  function makeThread(user, category, title, body, at) {
    const thread = { id: uid('t'), category, title, authorId: user.id, createdAt: at, bestPostId: null };
    db.threads.push(thread);
    makePost(thread, user, body, at, true);
    return thread;
  }
  function makePost(thread, user, body, at, isOp) {
    const post = {
      id: uid('p'), threadId: thread.id, authorId: user.id, body, createdAt: at,
      isOp: !!isOp, likes: [], reports: [], hidden: false, autoHidden: false, penalty: 0,
    };
    db.posts.push(post);
    return post;
  }
  const findThread = (id) => {
    const t = db.threads.find((x) => x.id === id);
    if (!t) throw new Error('スレッドが見つかりません');
    return t;
  };
  const findPost = (id) => {
    const p = db.posts.find((x) => x.id === id);
    if (!p) throw new Error('投稿が見つかりません');
    return p;
  };

  function createThread(input) {
    const user = requireUser();
    checkCooldown(user);
    if (!CATEGORIES.includes(input.category)) throw new Error('カテゴリを選んでください');
    const title = cleanText(input.title, 'タイトル', 1, 60);
    const body = cleanText(input.body, '本文', 1, 2000);
    const thread = makeThread(user, input.category, title, body, now());
    user.lastPostAt = now();
    const r = awardForPost(user, RULES.thread, body, 'スレッドを立てた');
    markMission(user, 'thread');
    save();
    return { thread, awarded: r.awarded, note: r.note };
  }

  function createReply(threadId, bodyIn) {
    const user = requireUser();
    checkCooldown(user);
    const thread = findThread(threadId);
    const body = cleanText(bodyIn, '返信', 1, 2000);
    makePost(thread, user, body, now(), false);
    user.lastPostAt = now();
    const r = awardForPost(user, RULES.reply, body, '返信した');
    markMission(user, 'reply');
    save();
    return { awarded: r.awarded, note: r.note };
  }

  function toggleLike(postId) {
    const me = requireUser();
    const p = findPost(postId);
    if (p.hidden) throw new Error('この投稿にはいいねできません');
    if (p.authorId === me.id) throw new Error('自分の投稿にはいいねできません');
    const author = userRaw(p.authorId);
    const i = p.likes.indexOf(me.id);
    if (i >= 0) {
      p.likes.splice(i, 1);
      if (author) addPoints(author, -RULES.likeReceived, 'いいねの取り消し');
    } else {
      p.likes.push(me.id);
      if (author) addPoints(author, RULES.likeReceived, 'いいねをもらった');
    }
    save();
    return i < 0;
  }

  // ベストアンサー: スレッドを立てた本人だけが選べる。同じ投稿をもう一度押すと取り消し
  function setBest(threadId, postId) {
    const me = requireUser();
    const t = findThread(threadId);
    if (t.authorId !== me.id) throw new Error('ベストアンサーを選べるのはスレッドを立てた人だけです');
    const p = findPost(postId);
    if (p.threadId !== t.id || p.isOp) throw new Error('この投稿はベストアンサーにできません');
    if (p.hidden) throw new Error('非表示の投稿は選べません');
    if (p.authorId === me.id) throw new Error('自分の投稿はベストアンサーにできません');
    const prev = t.bestPostId ? db.posts.find((x) => x.id === t.bestPostId) : null;
    if (prev) {
      const pa = userRaw(prev.authorId);
      if (pa) addPoints(pa, -RULES.best, 'ベストアンサーの取り消し');
    }
    if (prev && prev.id === p.id) {
      t.bestPostId = null;
      save();
      return false;
    }
    t.bestPostId = p.id;
    const author = userRaw(p.authorId);
    if (author) addPoints(author, RULES.best, 'ベストアンサーに選ばれた');
    save();
    return true;
  }

  function report(postId, reason) {
    const me = requireUser();
    const p = findPost(postId);
    if (p.authorId === me.id) throw new Error('自分の投稿は通報できません');
    if (p.reports.some((r) => r.userId === me.id)) throw new Error('この投稿はすでに通報済みです');
    p.reports.push({ userId: me.id, reason: String(reason || 'その他').slice(0, 40), at: now() });
    if (p.reports.length >= RULES.reportHideAt && !p.hidden) {
      p.hidden = true;
      p.autoHidden = true;
    }
    save();
  }

  // ---------- 閲覧 ----------
  function listThreads(opts) {
    const o = Object.assign({ category: '', q: '', sort: 'new' }, opts || {});
    const me = meRaw();
    const admin = !!(me && me.isAdmin);
    const kw = o.q.trim().toLowerCase();
    const rows = [];
    for (const t of db.threads) {
      const posts = db.posts.filter((p) => p.threadId === t.id);
      const op = posts.find((p) => p.isOp);
      if (!op || (op.hidden && !admin)) continue;
      if (o.category && t.category !== o.category) continue;
      if (kw && !(t.title.toLowerCase().includes(kw) || op.body.toLowerCase().includes(kw))) continue;
      rows.push({
        thread: t,
        author: publicUser(t.authorId),
        excerpt: op.body.replace(/\s+/g, ' ').slice(0, 100),
        replies: posts.filter((p) => !p.isOp && !p.hidden).length,
        likes: op.likes.length,
        last: Math.max.apply(null, posts.map((p) => p.createdAt)),
        hasBest: !!t.bestPostId,
      });
    }
    if (o.sort === 'wait') {
      // 返信待ち: まだ誰にも返信されていないスレッドを新しい順に
      const waiting = rows.filter((r) => r.replies === 0).sort((a, b) => b.thread.createdAt - a.thread.createdAt);
      return waiting;
    }
    if (o.sort === 'active') rows.sort((a, b) => b.last - a.last);
    else if (o.sort === 'hot') rows.sort((a, b) => (b.replies + b.likes * 2) - (a.replies + a.likes * 2) || b.last - a.last);
    else rows.sort((a, b) => b.thread.createdAt - a.thread.createdAt);
    return rows;
  }

  // 非表示の投稿は、管理者以外には本文を渡さない
  function getThread(id) {
    const thread = db.threads.find((t) => t.id === id);
    if (!thread) return null;
    const me = meRaw();
    const admin = !!(me && me.isAdmin);
    const posts = db.posts
      .filter((p) => p.threadId === id)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((p) => {
        const masked = p.hidden && !admin;
        return {
          id: p.id, isOp: p.isOp, createdAt: p.createdAt, hidden: p.hidden, masked,
          body: masked ? '' : p.body,
          author: publicUser(p.authorId),
          likeCount: p.likes.length,
          likedByMe: !!me && p.likes.includes(me.id),
          reportedByMe: !!me && p.reports.some((r) => r.userId === me.id),
          reportCount: admin ? p.reports.length : 0,
          isBest: thread.bestPostId === p.id,
        };
      });
    return { thread, author: publicUser(thread.authorId), posts };
  }

  function statsOf(userId) {
    const posts = db.posts.filter((p) => p.authorId === userId && !p.hidden);
    const best = db.threads.filter((t) => {
      const p = t.bestPostId && db.posts.find((x) => x.id === t.bestPostId);
      return p && p.authorId === userId;
    }).length;
    return {
      posts: posts.length,
      threads: db.threads.filter((t) => t.authorId === userId).length,
      likes: posts.reduce((s, p) => s + p.likes.length, 0),
      best,
    };
  }

  function myProfile() {
    const u = meRaw();
    if (!u) return null;
    const stats = statsOf(u.id);
    return {
      user: currentUser(),
      stats,
      badges: BADGES.map((b) => ({ id: b.id, icon: b.icon, name: b.name, desc: b.desc, earned: b.test(stats) })),
      history: db.log.filter((l) => l.userId === u.id).slice(-20).reverse(),
      threads: db.threads.filter((t) => t.authorId === u.id).sort((a, b) => b.createdAt - a.createdAt),
    };
  }

  function ranking(period) {
    let rows;
    if (period === 'month') {
      const mk = monthKey(now());
      const sums = {};
      db.log.forEach((l) => { if (monthKey(l.at) === mk) sums[l.userId] = (sums[l.userId] || 0) + l.amount; });
      rows = Object.keys(sums).map((id) => ({ user: publicUser(id), points: sums[id] }));
    } else {
      rows = db.users.map((u) => ({ user: publicUser(u.id), points: u.points }));
    }
    return rows.filter((r) => r.points > 0).sort((a, b) => b.points - a.points).slice(0, 20);
  }

  // ---------- 管理 ----------
  function listReported() {
    requireAdmin();
    return db.posts
      .filter((p) => p.reports.length > 0 || p.hidden)
      .sort((a, b) => b.reports.length - a.reports.length)
      .map((p) => {
        const t = db.threads.find((x) => x.id === p.threadId);
        return {
          id: p.id, threadId: p.threadId, threadTitle: t ? t.title : '(削除済み)',
          body: p.body, hidden: p.hidden, autoHidden: p.autoHidden, penalty: p.penalty,
          author: publicUser(p.authorId), reasons: p.reports.map((r) => r.reason), createdAt: p.createdAt,
        };
      });
  }

  function hidePost(postId) {
    requireAdmin();
    const p = findPost(postId);
    p.hidden = true;
    p.autoHidden = false;
    const author = userRaw(p.authorId);
    if (author && !p.penalty) p.penalty = -addPoints(author, -RULES.hiddenPenalty, '投稿が非表示になった');
    const t = db.threads.find((x) => x.id === p.threadId);
    if (t && t.bestPostId === p.id) {
      t.bestPostId = null;
      if (author) addPoints(author, -RULES.best, 'ベストアンサーの取り消し');
    }
    save();
  }

  function restorePost(postId) {
    requireAdmin();
    const p = findPost(postId);
    p.hidden = false;
    p.autoHidden = false;
    p.reports = [];
    const author = userRaw(p.authorId);
    if (author && p.penalty) addPoints(author, p.penalty, '非表示の取り消し');
    p.penalty = 0;
    save();
  }

  function getNgWords() { requireAdmin(); return db.ngWords.slice(); }
  function setNgWords(input) {
    requireAdmin();
    const list = Array.isArray(input) ? input : String(input || '').split(/[\n,、]/);
    db.ngWords = Array.from(new Set(list.map((w) => w.trim()).filter(Boolean)));
    save();
  }

  function resetAll() {
    requireAdmin();
    setSession(null);
    seed();
    save();
  }

  function drainNotices() {
    const n = notices;
    notices = [];
    return n;
  }

  // ---------- 初期データ(サンプル) ----------
  function seed() {
    db = { users: [], threads: [], posts: [], log: [], ngWords: DEFAULT_NG.slice() };
    const H = 3600 * 1000;
    const mk = (nick, pts, daysAgo) => {
      const u = {
        id: uid('u'), email: nick + '@demo.invalid', nickname: nick, salt: '', hash: '!', points: 0,
        createdAt: now() - daysAgo * 24 * H, lastBonusDate: '', lastPostAt: 0, postPt: null, demo: true, isAdmin: false,
      };
      db.users.push(u);
      addPoints(u, pts, 'サンプルデータ');
      return u;
    };
    const yuki = mk('ゆうき', 68, 12);
    const mina = mk('みな', 41, 9);
    const taro = mk('たろう', 23, 4);

    const t1 = makeThread(yuki, '雑談', 'はじめまして!自己紹介スレ',
      'ひろば掲示板へようこそ。ここでは誰でも自由に投稿できます。\nまずは名前と最近ハマっていることを教えてください。私は最近、朝の散歩にハマっています。', now() - 30 * H);
    const r1 = makePost(t1, mina, 'はじめまして!最近はパン作りにハマっています。休日に焼くのが楽しみです。', now() - 28 * H);
    makePost(t1, taro, '同じく初参加です。よろしくお願いします。散歩、気持ちよさそうですね。', now() - 20 * H);
    r1.likes.push(yuki.id, taro.id);

    const t2 = makeThread(taro, '相談・質問', '在宅でできる副業、まず何から始めるのがいいですか?',
      '本業の合間に、在宅でできる副業を始めたいと思っています。\n時間は平日の夜に1時間ほど取れます。おすすめや、失敗談があれば教えてください。', now() - 10 * H);
    const r2 = makePost(t2, yuki, 'まずは「自分の得意なこと」を書き出すのがおすすめです。小さく試して、反応を見ながら伸ばすと失敗が少ないですよ。', now() - 8 * H);
    makePost(t2, mina, '私はまず、初期費用がかからないものから始めました。続けられるかを確かめるのが大事だと思います。', now() - 6 * H);
    r2.likes.push(taro.id, mina.id);
    t2.bestPostId = r2.id;

    const t3 = makeThread(mina, '健康・リハビリ', '肩こり対策、みなさんは何をしていますか?',
      'デスクワークで肩こりがひどいです。ストレッチ、湯船、マッサージなど、続けやすくて効果を感じたものを教えてください。', now() - 3 * H);
    makePost(t3, yuki, '1時間に1回、立って肩甲骨を寄せる動きをするだけでも違います。タイマーをかけると忘れません。', now() - 2 * H);
  }

  // ---------- 起動 ----------
  db = load();
  if (!db) {
    seed();
    save();
  }

  global.Store = {
    CATEGORIES, LEVELS, RULES, BADGES,
    reload, currentUser, register, login, logout, dailyBonus,
    createThread, createReply, toggleLike, setBest, report,
    listThreads, getThread, myProfile, ranking, missions, todayTopic,
    listReported, hidePost, restorePost, getNgWords, setNgWords, resetAll,
    drainNotices, levelOf,
    KEYS: { data: KEY, session: SESSION_KEY },
  };
})(window);
