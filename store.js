/*
 * store.js — データ層(Supabase)
 *
 * 画面(app.js)はこのファイルの Store だけを通してデータを読み書きする。
 *
 * しくみ:
 *   - 読み取りは Store.load(ルート) で必要なデータをまとめて取得し、メモリに保持する。
 *     その後の Store.listThreads() などは、保持したデータを同期的に返す(画面側は今までと同じ書き方でよい)。
 *   - 書き込み(投稿・いいね等)は非同期。サーバー(supabase/schema.sql の関数)が
 *     ポイント計算・権限チェック・NGワード判定を行うので、ブラウザ側で改ざんはできない。
 *   - ポイントのルール(RULES)は表示用。実際の値は schema.sql の rule_pts() が正で、同じ値にしておく。
 */
(function (global) {
  'use strict';

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

  // 表示用のルール(実際の判定は schema.sql の rule_pts())
  const RULES = {
    register: 10,
    daily: 1,
    thread: 5,
    reply: 2,
    likeReceived: 1,
    best: 10,
    hiddenPenalty: 10,
    dailyPostCap: 30,
    minLength: 10,
    cooldownSec: 20,
    reportHideAt: 3,
    missionBonus: 3,
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

  // ---------- Supabase クライアント ----------
  const cfg = global.KEIJIBAN_CONFIG || {};
  let configProblem = '';
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) configProblem = 'config';
  else if (!global.supabase || !global.supabase.createClient) configProblem = 'library';
  const ready = !configProblem;

  const sb = ready
    ? global.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        // PKCE: メール確認後の戻りで、URL の # をトークンに使わない(この画面は # をページ切り替えに使っているため)
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

  // ---------- 状態(メモリ上のキャッシュ) ----------
  let session = null;
  let me = null; // get_me() の結果。未ログインは null
  let lastUid = null;
  let notices = [];
  const listeners = [];
  const cache = {
    threads: [],
    thread: null,
    ranking: { total: [], month: [] },
    profile: null,
    reported: [],
    ngWords: [],
  };

  // ---------- 小さな道具 ----------
  const uidOf = (s) => (s && s.user ? s.user.id : null);
  const num = (v) => Number(v) || 0;

  function explain(err) {
    const m = String((err && err.message) || err || '');
    const status = err && err.status;
    if (err && err.code === 'PGRST202') return 'サーバーの設定が完了していません(supabase/schema.sql を実行してください)';
    if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(m)) return 'サーバーに接続できませんでした。通信状況を確認してください';
    if (/Anonymous sign-ins are disabled/i.test(m)) return '現在、新規登録を受け付けていません(管理者にお知らせください)';
    if (/rate limit|too many requests|over_.*_rate_limit/i.test(m) || status === 429) return '短時間に操作が集中しています。しばらく待ってからもう一度お試しください';
    if (/JWT expired|invalid JWT/i.test(m)) return 'ログインの有効期限が切れました。もう一度ログインしてください';
    if (/Signups not allowed|signup.*disabled/i.test(m)) return '現在、新規登録を受け付けていません';
    return m || '予期しないエラーが起きました';
  }

  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args || {});
    if (error) {
      const e = new Error(explain(error));
      e.raw = error;
      throw e;
    }
    return data;
  }

  // ---------- レベル・ユーザー ----------
  function levelOf(points) {
    let cur = LEVELS[0];
    for (const l of LEVELS) if (points >= l.min) cur = l;
    const next = LEVELS.find((l) => l.min > points) || null;
    const progress = next ? (points - cur.min) / (next.min - cur.min) : 1;
    return { lv: cur.lv, title: cur.title, min: cur.min, next, progress };
  }

  // サーバーから来た {id, nickname, points, isAdmin?} を、画面が使う形にする
  function publicUser(a) {
    const points = num(a.points);
    return { id: a.id, nickname: a.nickname, points, level: levelOf(points), isAdmin: !!a.isAdmin };
  }

  function currentUser() {
    if (!me) return null;
    return Object.assign(publicUser(me), { createdAt: me.createdAt });
  }

  function missions() {
    if (!me) return null;
    const m = me.missions || {};
    return {
      items: [
        { id: 'login', label: '今日ログインする', pts: RULES.daily, done: true },
        { id: 'reply', label: '誰かの投稿に返信する', pts: RULES.reply, done: !!m.reply },
        { id: 'thread', label: 'スレッドを立てる', pts: RULES.thread, done: !!m.thread },
      ],
      bonus: RULES.missionBonus,
      bonusDone: !!m.bonus,
      postPt: { used: num(m.postPtUsed), cap: RULES.dailyPostCap },
    };
  }

  function todayTopic() {
    const d = new Date();
    const n = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    return DAILY_TOPICS[n % DAILY_TOPICS.length];
  }

  // ---------- 起動・認証 ----------
  async function init() {
    if (!ready) return;
    const { data } = await sb.auth.getSession(); // メール確認後の ?code= もここで処理される
    session = data.session;
    lastUid = uidOf(session);
    sb.auth.onAuthStateChange((event, s) => {
      session = s;
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      const id = uidOf(s);
      if (event !== 'SIGNED_OUT' && id === lastUid) return;
      lastUid = id;
      if (!id) me = null;
      // コールバックの中で Supabase を呼ぶとデッドロックするので、少し遅らせて通知する
      setTimeout(() => listeners.forEach((f) => f(event)), 0);
    });
    await refreshMe();
  }

  function onAuthChange(fn) { listeners.push(fn); }

  async function refreshMe() {
    if (!session) { me = null; return; }
    me = await rpc('get_me');
  }

  const pointsNow = () => (me ? me.points : 0);

  // 書き込みの後: 増減したポイントをお知らせに積み、レベルアップを判定する
  async function afterWrite(events, before) {
    (events || []).forEach((e) => notices.push({ type: 'points', amount: num(e.amount), reason: e.reason }));
    await refreshMe();
    if (me) {
      const b = levelOf(before);
      const a = levelOf(me.points);
      if (a.lv > b.lv) notices.push({ type: 'levelup', lv: a.lv, title: a.title });
    }
  }

  // はじめる: ニックネームだけで始める(Supabase の匿名ログイン)。
  // メールもパスワードも使わない。アカウントはこのブラウザにだけ保存され、
  // ログアウトやブラウザのデータ削除をすると同じアカウントには戻れない。
  async function register(input) {
    const nickname = String(input.nickname || '').trim();
    if (nickname.length < 2 || nickname.length > 16) throw new Error('ニックネームは2〜16文字で入力してください');
    const msg = await rpc('nickname_available', { p_nick: nickname });
    if (msg) throw new Error(msg);

    const { data, error } = await sb.auth.signInAnonymously({ options: { data: { nickname } } });
    if (error) throw new Error(explain(error));
    session = data.session;
    lastUid = uidOf(session);
    await refreshMe();
    if (!me) throw new Error('アカウントの作成に失敗しました。もう一度お試しください');
    notices.push({ type: 'points', amount: RULES.register, reason: '新規登録ボーナス' });
  }

  async function logout() {
    await sb.auth.signOut();
    session = null;
    me = null;
    lastUid = null;
    cache.profile = null;
  }

  // 1日1回のログインボーナス
  async function dailyBonus() {
    if (!session || !me) return false;
    const before = me.points;
    const events = await rpc('daily_bonus');
    if (!events || !events.length) return false;
    await afterWrite(events, before);
    return true;
  }

  // ---------- 読み取り(サーバーから取得してキャッシュ) ----------
  async function loadThreads() {
    const rows = await rpc('list_threads');
    cache.threads = (rows || []).map((r) => ({
      thread: { id: r.id, category: r.category, title: r.title, createdAt: r.createdAt },
      author: publicUser(r.author),
      excerpt: r.excerpt || '',
      replies: num(r.replies),
      likes: num(r.likes),
      last: num(r.last),
      hasBest: !!r.hasBest,
    }));
  }

  async function loadThread(id) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) { cache.thread = null; return; }
    const d = await rpc('get_thread', { p_id: id });
    if (!d) { cache.thread = null; return; }
    cache.thread = {
      thread: d.thread,
      author: publicUser(d.author),
      posts: (d.posts || []).map((p) => ({
        id: p.id,
        isOp: !!p.isOp,
        createdAt: p.createdAt,
        hidden: !!p.hidden,
        masked: !!p.masked,
        body: p.body || '',
        author: publicUser(p.author),
        likeCount: num(p.likeCount),
        likedByMe: !!p.likedByMe,
        reportedByMe: !!p.reportedByMe,
        reportCount: num(p.reportCount),
        isBest: !!p.isBest,
      })),
    };
  }

  async function loadRanking(period) {
    const rows = await rpc('ranking', { p_period: period });
    cache.ranking[period] = (rows || []).map((r) => ({ user: publicUser(r.user), points: num(r.points) }));
  }

  async function loadProfile() {
    if (!session) { cache.profile = null; return; }
    cache.profile = await rpc('my_profile');
  }

  async function loadAdmin() {
    if (!me || !me.isAdmin) { cache.reported = []; cache.ngWords = []; return; }
    const [rep, words] = await Promise.all([rpc('admin_list_reported'), rpc('admin_get_ng_words')]);
    cache.reported = (rep || []).map((p) => ({
      id: p.id, threadId: p.threadId, threadTitle: p.threadTitle, body: p.body, hidden: !!p.hidden,
      autoHidden: !!p.autoHidden, penalty: num(p.penalty), author: publicUser(p.author),
      reasons: p.reasons || [], createdAt: p.createdAt,
    }));
    cache.ngWords = words || [];
  }

  // 画面(ルート)ごとに必要なデータをまとめて取得する
  async function load(seg) {
    if (!ready) return;
    const route = seg[0];
    if (route === 'admin') {
      await refreshMe();
      await loadAdmin();
      return;
    }
    const tasks = [refreshMe()];
    if (route === undefined) {
      tasks.push(loadThreads(), loadRanking('month').then(() => (cache.ranking.month.length ? null : loadRanking('total'))));
    } else if (route === 'thread') {
      tasks.push(loadThread(seg[1]), loadThreads());
    } else if (route === 'me') {
      tasks.push(loadProfile());
    } else if (route === 'ranking') {
      tasks.push(loadRanking('total'), loadRanking('month'));
    }
    await Promise.all(tasks);
  }

  // ---------- 読み取り(キャッシュを同期的に返す) ----------
  function listThreads(opts) {
    const o = Object.assign({ category: '', q: '', sort: 'new' }, opts || {});
    const kw = o.q.trim().toLowerCase();
    let rows = cache.threads.filter((r) => {
      if (o.category && r.thread.category !== o.category) return false;
      if (kw && !(r.thread.title.toLowerCase().includes(kw) || r.excerpt.toLowerCase().includes(kw))) return false;
      return true;
    });
    if (o.sort === 'wait') {
      // 返信待ち: まだ誰にも返信されていないスレッドを新しい順に
      return rows.filter((r) => r.replies === 0).sort((a, b) => b.thread.createdAt - a.thread.createdAt);
    }
    rows = rows.slice();
    if (o.sort === 'active') rows.sort((a, b) => b.last - a.last);
    else if (o.sort === 'hot') rows.sort((a, b) => (b.replies + b.likes * 2) - (a.replies + a.likes * 2) || b.last - a.last);
    else rows.sort((a, b) => b.thread.createdAt - a.thread.createdAt);
    return rows;
  }

  function getThread(id) {
    return cache.thread && cache.thread.thread.id === id ? cache.thread : null;
  }

  function ranking(period) {
    return cache.ranking[period] || [];
  }

  function myProfile() {
    if (!me || !cache.profile) return null;
    const stats = {
      posts: num(cache.profile.stats.posts),
      threads: num(cache.profile.stats.threads),
      likes: num(cache.profile.stats.likes),
      best: num(cache.profile.stats.best),
    };
    return {
      user: currentUser(),
      stats,
      badges: BADGES.map((b) => ({ id: b.id, icon: b.icon, name: b.name, desc: b.desc, earned: b.test(stats) })),
      history: (cache.profile.history || []).map((h) => ({ amount: num(h.amount), reason: h.reason, at: h.at })),
      threads: (cache.profile.threads || []).map((t) => ({ id: t.id, title: t.title, createdAt: t.createdAt })),
    };
  }

  const listReported = () => cache.reported;
  const getNgWords = () => cache.ngWords.slice();

  // ---------- 書き込み ----------
  async function createThread(input) {
    const before = pointsNow();
    const r = await rpc('create_thread', { p_category: input.category, p_title: input.title, p_body: input.body });
    await afterWrite(r.events, before);
    return { thread: { id: r.threadId }, note: r.note || '' };
  }

  async function createReply(threadId, body) {
    const before = pointsNow();
    const r = await rpc('create_reply', { p_thread: threadId, p_body: body });
    await afterWrite(r.events, before);
    return { note: r.note || '' };
  }

  async function toggleLike(postId) {
    return !!(await rpc('toggle_like', { p_post: postId }));
  }

  async function setBest(threadId, postId) {
    return !!(await rpc('set_best', { p_thread: threadId, p_post: postId }));
  }

  async function report(postId, reason) {
    await rpc('report_post', { p_post: postId, p_reason: reason });
  }

  async function hidePost(postId) { await rpc('admin_hide_post', { p_post: postId }); }
  async function restorePost(postId) { await rpc('admin_restore_post', { p_post: postId }); }

  async function setNgWords(input) {
    const list = Array.isArray(input) ? input : String(input || '').split(/[\n,、]/);
    await rpc('admin_set_ng_words', { p_words: list.map((w) => w.trim()).filter(Boolean) });
  }

  function drainNotices() {
    const n = notices;
    notices = [];
    return n;
  }

  global.Store = {
    CATEGORIES, LEVELS, RULES, BADGES,
    ready, configProblem,
    init, onAuthChange, load,
    currentUser, missions, todayTopic,
    register, logout, dailyBonus,
    listThreads, getThread, ranking, myProfile, listReported, getNgWords,
    createThread, createReply, toggleLike, setBest, report,
    hidePost, restorePost, setNgWords,
    drainNotices, levelOf,
  };
})(window);
