-- =====================================================================
-- ひろば掲示板 — Supabase スキーマ
--
-- 使い方: Supabase ダッシュボード > SQL Editor に全文を貼り付けて Run。
--         何度実行しても安全な書き方にしてある(テーブルは作り直さない)。
--
-- 設計方針:
--   * すべてのテーブルで RLS を有効にし、ポリシーを作らない = ブラウザからの直接アクセスは全面禁止。
--   * 読み書きはすべて security definer の関数(RPC)経由。
--   * ポイント計算・権限チェック・NGワード判定・連続投稿制限をサーバー側で行い、改ざんを防ぐ。
--   * ポイントの数値ルールは rule_pts() に集約(画面側 store.js の RULES と同じ値にしておく)。
-- =====================================================================


-- ---------------------------------------------------------------------
-- テーブル
-- ---------------------------------------------------------------------

-- ユーザーの公開プロフィールとポイント(メールアドレスは auth.users 側にあり、ここには置かない)
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  nickname        text not null check (char_length(nickname) between 2 and 16),
  points          integer not null default 0 check (points >= 0),
  is_admin        boolean not null default false,
  created_at      timestamptz not null default now(),
  last_bonus_date date,
  last_post_at    timestamptz,
  post_pt_date    date,
  post_pt_amount  integer not null default 0,
  daily_date      date,
  daily_thread    boolean not null default false,
  daily_reply     boolean not null default false,
  daily_bonus     boolean not null default false
);
create unique index if not exists profiles_nickname_lower_key on public.profiles (lower(nickname));

create table if not exists public.threads (
  id           uuid primary key default gen_random_uuid(),
  category     text not null check (category in ('雑談', '相談・質問', '仕事・副業', '健康・リハビリ', '趣味', '意見交換')),
  title        text not null check (char_length(title) between 1 and 60),
  author_id    uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  best_post_id uuid
);
create index if not exists threads_created_idx on public.threads (created_at desc);

create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.threads (id) on delete cascade,
  author_id   uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  is_op       boolean not null default false,
  created_at  timestamptz not null default now(),
  hidden      boolean not null default false,
  auto_hidden boolean not null default false,
  penalty     integer not null default 0
);
create index if not exists posts_thread_idx on public.posts (thread_id, created_at);
create index if not exists posts_author_idx on public.posts (author_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'threads_best_post_fk') then
    alter table public.threads
      add constraint threads_best_post_fk foreign key (best_post_id) references public.posts (id) on delete set null;
  end if;
end $$;

create table if not exists public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.post_reports (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  reason     text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.points_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  amount     integer not null,
  reason     text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists points_log_user_idx on public.points_log (user_id, id desc);
create index if not exists points_log_created_idx on public.points_log (created_at);

create table if not exists public.ng_words (
  word text primary key
);
insert into public.ng_words (word) values ('死ね'), ('殺す'), ('出会い系'), ('カジノ') on conflict do nothing;

-- 直接アクセスを全面禁止(ポリシーを作らない)
alter table public.profiles     enable row level security;
alter table public.threads      enable row level security;
alter table public.posts        enable row level security;
alter table public.post_likes   enable row level security;
alter table public.post_reports enable row level security;
alter table public.points_log   enable row level security;
alter table public.ng_words     enable row level security;


-- ---------------------------------------------------------------------
-- 内部ヘルパー(ブラウザからは呼べない。末尾で実行権限を外す)
-- ---------------------------------------------------------------------

create or replace function public.today_jst() returns date
language sql stable as $$
  select (now() at time zone 'Asia/Tokyo')::date
$$;

-- 時刻をミリ秒の数値にする(JavaScript の Date とそのまま使える)
create or replace function public.ms(ts timestamptz) returns bigint
language sql immutable as $$
  select (extract(epoch from ts) * 1000)::bigint
$$;

-- ポイントなどの数値ルール(store.js の RULES と同じ値にする)
create or replace function public.rule_pts(k text) returns integer
language sql immutable as $$
  select case k
    when 'register' then 10   -- 新規登録
    when 'daily'    then 1    -- ログインボーナス(1日1回)
    when 'thread'   then 5    -- スレッドを立てる
    when 'reply'    then 2    -- 返信する
    when 'like'     then 1    -- いいねをもらう
    when 'best'     then 10   -- ベストアンサー
    when 'penalty'  then 10   -- 非表示にされた投稿の減点
    when 'mission'  then 3    -- スレッド+返信のミッションボーナス
    when 'cap'      then 30   -- 投稿ポイントの1日の上限
    when 'minlen'   then 10   -- ポイント対象になる最小文字数
    when 'cooldown' then 20   -- 連続投稿の間隔(秒)
    when 'hide_at'  then 3    -- 通報がこの数で自動非表示
  end
$$;

create or replace function public.require_user() returns uuid
language plpgsql stable as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  return auth.uid();
end $$;

create or replace function public.me_is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.require_admin() returns uuid
language plpgsql stable as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if not public.me_is_admin() then
    raise exception '管理者のみ操作できます';
  end if;
  return auth.uid();
end $$;

-- ポイントの加減算。実際に増減した量を返す(0 未満にはならない)
create or replace function public.add_points(p_user uuid, p_amount integer, p_reason text) returns integer
language plpgsql as $$
declare
  cur integer;
  nxt integer;
  delta integer;
begin
  select points into cur from public.profiles where id = p_user for update;
  if not found then
    return 0;
  end if;
  nxt := greatest(0, cur + p_amount);
  delta := nxt - cur;
  if delta = 0 then
    return 0;
  end if;
  update public.profiles set points = nxt where id = p_user;
  insert into public.points_log (user_id, amount, reason) values (p_user, delta, p_reason);
  return delta;
end $$;

-- NGワードを含んでいれば、その語を返す
create or replace function public.find_ng(t text) returns text
language sql stable as $$
  select word from public.ng_words
  where word <> '' and position(lower(word) in lower(regexp_replace(t, '\s', '', 'g'))) > 0
  limit 1
$$;

-- 前後の空白を除き、長さとNGワードを検査して返す
create or replace function public.clean_text(t text, label text, mn integer, mx integer) returns text
language plpgsql stable as $$
declare
  s text;
  ng text;
begin
  s := regexp_replace(replace(coalesce(t, ''), E'\r\n', E'\n'), '^\s+|\s+$', '', 'g');
  if char_length(s) < mn then
    raise exception '%を入力してください', label;
  end if;
  if char_length(s) > mx then
    raise exception '%は%文字以内で入力してください', label, mx;
  end if;
  ng := public.find_ng(s);
  if ng is not null then
    raise exception '%に使用できない言葉「%」が含まれています', label, ng;
  end if;
  return s;
end $$;

-- 連続投稿の制限
create or replace function public.check_cooldown(u uuid) returns void
language plpgsql stable as $$
declare
  l timestamptz;
  wait integer;
begin
  select last_post_at into l from public.profiles where id = u;
  if l is not null then
    wait := ceil(extract(epoch from (l + make_interval(secs => public.rule_pts('cooldown')) - now())))::integer;
    if wait > 0 then
      raise exception '連続投稿を防ぐため、あと%秒お待ちください', wait;
    end if;
  end if;
end $$;

-- 投稿ポイント: 短すぎる投稿は対象外、1日の上限あり。補足メッセージ(なければ空文字)を返す
create or replace function public.award_for_post(u uuid, base integer, body text, reason text) returns text
language plpgsql as $$
declare
  p public.profiles%rowtype;
  t date := public.today_jst();
  give integer;
begin
  if char_length(regexp_replace(body, '\s', '', 'g')) < public.rule_pts('minlen') then
    return public.rule_pts('minlen') || '文字未満の投稿はポイント対象外です';
  end if;
  select * into p from public.profiles where id = u for update;
  if p.post_pt_date is distinct from t then
    update public.profiles set post_pt_date = t, post_pt_amount = 0 where id = u;
    p.post_pt_amount := 0;
  end if;
  give := least(base, greatest(0, public.rule_pts('cap') - p.post_pt_amount));
  if give <= 0 then
    return '本日の投稿ポイント上限に達しました(明日またためられます)';
  end if;
  update public.profiles set post_pt_amount = post_pt_amount + give where id = u;
  perform public.add_points(u, give, reason);
  return '';
end $$;

-- 今日のミッション: スレッド・返信の両方をやった日はボーナス
create or replace function public.mark_mission(u uuid, kind text) returns void
language plpgsql as $$
declare
  p public.profiles%rowtype;
  t date := public.today_jst();
begin
  select * into p from public.profiles where id = u for update;
  if p.daily_date is distinct from t then
    update public.profiles
      set daily_date = t, daily_thread = false, daily_reply = false, daily_bonus = false
      where id = u;
  end if;
  if kind = 'thread' then
    update public.profiles set daily_thread = true where id = u;
  else
    update public.profiles set daily_reply = true where id = u;
  end if;
  select * into p from public.profiles where id = u;
  if p.daily_thread and p.daily_reply and not p.daily_bonus then
    update public.profiles set daily_bonus = true where id = u;
    perform public.add_points(u, public.rule_pts('mission'), '今日のミッション達成ボーナス');
  end if;
end $$;

-- 指定時刻以降に増減したポイントの一覧(画面の「+5pt」表示用)
create or replace function public.events_since(u uuid, t0 timestamptz) returns jsonb
language sql stable as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('amount', amount, 'reason', reason) order by id),
    '[]'::jsonb)
  from public.points_log
  where user_id = u and created_at >= t0
$$;


-- ---------------------------------------------------------------------
-- 新規登録時にプロフィールを自動作成
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  nick text;
  first_user boolean;
begin
  nick := btrim(coalesce(new.raw_user_meta_data ->> 'nickname', ''));
  -- 直接 API を叩いて不正なニックネームを渡された場合は、自動採番に置き換える
  if char_length(nick) < 2 or char_length(nick) > 16
     or public.find_ng(nick) is not null
     or exists (select 1 from public.profiles where lower(nickname) = lower(nick)) then
    nick := 'user' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  -- 最初に登録した人を管理者にする(先にご自身で登録してください)
  first_user := not exists (select 1 from public.profiles);
  insert into public.profiles (id, nickname, is_admin, last_bonus_date)
    values (new.id, nick, first_user, public.today_jst());
  perform public.add_points(new.id, public.rule_pts('register'), '新規登録ボーナス');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- 公開関数(RPC): 読み取り
-- ---------------------------------------------------------------------

-- 登録前のニックネーム検査(空文字なら使える)
create or replace function public.nickname_available(p_nick text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  n text := btrim(coalesce(p_nick, ''));
begin
  if char_length(n) < 2 or char_length(n) > 16 then
    return 'ニックネームは2〜16文字で入力してください';
  end if;
  if public.find_ng(n) is not null then
    return 'このニックネームは使用できません';
  end if;
  if exists (select 1 from public.profiles where lower(nickname) = lower(n)) then
    return 'このニックネームは既に使われています';
  end if;
  return '';
end $$;

-- ログイン中の自分の情報(未ログインなら null)
create or replace function public.get_me() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p public.profiles%rowtype;
  t date := public.today_jst();
begin
  if auth.uid() is null then
    return null;
  end if;
  select * into p from public.profiles where id = auth.uid();
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', p.id,
    'nickname', p.nickname,
    'points', p.points,
    'isAdmin', p.is_admin,
    'createdAt', public.ms(p.created_at),
    'missions', jsonb_build_object(
      'reply', coalesce(p.daily_date = t and p.daily_reply, false),
      'thread', coalesce(p.daily_date = t and p.daily_thread, false),
      'bonus', coalesce(p.daily_date = t and p.daily_bonus, false),
      'postPtUsed', case when p.post_pt_date = t then p.post_pt_amount else 0 end
    )
  );
end $$;

-- スレッド一覧(新しい順に最大200件)
create or replace function public.list_threads() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(s.x order by s.ca desc), '[]'::jsonb)
  from (
    select
      jsonb_build_object(
        'id', t.id,
        'category', t.category,
        'title', t.title,
        'createdAt', public.ms(t.created_at),
        'hasBest', t.best_post_id is not null,
        'author', jsonb_build_object('id', a.id, 'nickname', a.nickname, 'points', a.points),
        'excerpt', left(regexp_replace(op.body, '\s+', ' ', 'g'), 100),
        'replies', (select count(*) from public.posts r where r.thread_id = t.id and not r.is_op and not r.hidden),
        'likes', (select count(*) from public.post_likes l where l.post_id = op.id),
        'last', public.ms((select max(r.created_at) from public.posts r where r.thread_id = t.id))
      ) as x,
      t.created_at as ca
    from public.threads t
    join public.profiles a on a.id = t.author_id
    join public.posts op on op.thread_id = t.id and op.is_op
    where (not op.hidden or public.me_is_admin())
    order by t.created_at desc
    limit 200
  ) s
$$;

-- スレッド1件と全投稿。非表示の投稿は、管理者以外には本文を渡さない
create or replace function public.get_thread(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  t public.threads%rowtype;
  me uuid := auth.uid();
  adm boolean := public.me_is_admin();
begin
  select * into t from public.threads where id = p_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'thread', jsonb_build_object(
      'id', t.id, 'category', t.category, 'title', t.title,
      'authorId', t.author_id, 'createdAt', public.ms(t.created_at), 'bestPostId', t.best_post_id),
    'author', (select jsonb_build_object('id', a.id, 'nickname', a.nickname, 'points', a.points)
               from public.profiles a where a.id = t.author_id),
    'posts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'isOp', p.is_op,
          'createdAt', public.ms(p.created_at),
          'hidden', p.hidden,
          'masked', (p.hidden and not adm),
          'body', case when p.hidden and not adm then '' else p.body end,
          'author', jsonb_build_object('id', a.id, 'nickname', a.nickname, 'points', a.points),
          'likeCount', (select count(*) from public.post_likes l where l.post_id = p.id),
          'likedByMe', exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = me),
          'reportedByMe', exists (select 1 from public.post_reports r where r.post_id = p.id and r.user_id = me),
          'reportCount', case when adm then (select count(*) from public.post_reports r where r.post_id = p.id) else 0 end,
          'isBest', coalesce(t.best_post_id = p.id, false)
        )
        order by p.created_at, p.id)
      from public.posts p
      join public.profiles a on a.id = p.author_id
      where p.thread_id = t.id
    ), '[]'::jsonb)
  );
end $$;

-- ランキング(p_period: 'total' = 総合 / 'month' = 今月)
create or replace function public.ranking(p_period text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  res jsonb;
  month_start timestamptz;
begin
  if p_period = 'month' then
    month_start := date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'user', jsonb_build_object('id', r.id, 'nickname', r.nickname, 'points', r.points),
               'points', r.pts)
             order by r.pts desc, r.id), '[]'::jsonb)
      into res
    from (
      select p.id, p.nickname, p.points, sum(l.amount) as pts
      from public.points_log l
      join public.profiles p on p.id = l.user_id
      where l.created_at >= month_start
      group by p.id, p.nickname, p.points
      having sum(l.amount) > 0
      order by sum(l.amount) desc
      limit 20
    ) r;
  else
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'user', jsonb_build_object('id', r.id, 'nickname', r.nickname, 'points', r.points),
               'points', r.points)
             order by r.points desc, r.id), '[]'::jsonb)
      into res
    from (
      select id, nickname, points from public.profiles where points > 0 order by points desc limit 20
    ) r;
  end if;
  return res;
end $$;

-- マイページ用: 統計・ポイント履歴・自分のスレッド
create or replace function public.my_profile() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  u uuid := public.require_user();
begin
  return jsonb_build_object(
    'stats', jsonb_build_object(
      'posts', (select count(*) from public.posts where author_id = u and not hidden),
      'threads', (select count(*) from public.threads where author_id = u),
      'likes', (select count(*) from public.post_likes l join public.posts p on p.id = l.post_id
                where p.author_id = u and not p.hidden),
      'best', (select count(*) from public.threads t join public.posts p on p.id = t.best_post_id
               where p.author_id = u)
    ),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('amount', h.amount, 'reason', h.reason, 'at', public.ms(h.created_at))
                       order by h.id desc)
      from (select * from public.points_log where user_id = u order by id desc limit 20) h
    ), '[]'::jsonb),
    'threads', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'createdAt', public.ms(t.created_at))
                       order by t.created_at desc)
      from public.threads t where t.author_id = u
    ), '[]'::jsonb)
  );
end $$;


-- ---------------------------------------------------------------------
-- 公開関数(RPC): 書き込み
-- ---------------------------------------------------------------------

-- 1日1回のログインボーナス。増減したポイントの一覧を返す
create or replace function public.daily_bonus() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := auth.uid();
  t0 timestamptz := clock_timestamp();
  p public.profiles%rowtype;
  t date := public.today_jst();
begin
  if u is null then
    return '[]'::jsonb;
  end if;
  select * into p from public.profiles where id = u for update;
  if not found then
    return '[]'::jsonb;
  end if;
  if p.last_bonus_date is distinct from t then
    update public.profiles set last_bonus_date = t where id = u;
    perform public.add_points(u, public.rule_pts('daily'), 'ログインボーナス');
  end if;
  return public.events_since(u, t0);
end $$;

create or replace function public.create_thread(p_category text, p_title text, p_body text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public.require_user();
  t0 timestamptz := clock_timestamp();
  v_title text;
  v_body text;
  v_id uuid;
  note text;
begin
  perform public.check_cooldown(u);
  if p_category is null or p_category not in ('雑談', '相談・質問', '仕事・副業', '健康・リハビリ', '趣味', '意見交換') then
    raise exception 'カテゴリを選んでください';
  end if;
  v_title := public.clean_text(p_title, 'タイトル', 1, 60);
  v_body := public.clean_text(p_body, '本文', 1, 2000);
  insert into public.threads (category, title, author_id) values (p_category, v_title, u) returning id into v_id;
  insert into public.posts (thread_id, author_id, body, is_op) values (v_id, u, v_body, true);
  update public.profiles set last_post_at = now() where id = u;
  note := public.award_for_post(u, public.rule_pts('thread'), v_body, 'スレッドを立てた');
  -- ミッションに数えるのは、ポイント対象になる長さの投稿だけ(短文の連投でボーナスを稼げないように)
  if char_length(regexp_replace(v_body, '\s', '', 'g')) >= public.rule_pts('minlen') then
    perform public.mark_mission(u, 'thread');
  end if;
  return jsonb_build_object('threadId', v_id, 'note', note, 'events', public.events_since(u, t0));
end $$;

create or replace function public.create_reply(p_thread uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public.require_user();
  t0 timestamptz := clock_timestamp();
  v_body text;
  note text;
begin
  perform public.check_cooldown(u);
  if not exists (select 1 from public.threads where id = p_thread) then
    raise exception 'スレッドが見つかりません';
  end if;
  v_body := public.clean_text(p_body, '返信', 1, 2000);
  insert into public.posts (thread_id, author_id, body, is_op) values (p_thread, u, v_body, false);
  update public.profiles set last_post_at = now() where id = u;
  note := public.award_for_post(u, public.rule_pts('reply'), v_body, '返信した');
  if char_length(regexp_replace(v_body, '\s', '', 'g')) >= public.rule_pts('minlen') then
    perform public.mark_mission(u, 'reply');
  end if;
  return jsonb_build_object('note', note, 'events', public.events_since(u, t0));
end $$;

-- いいねの付け外し。付けたら true、外したら false
create or replace function public.toggle_like(p_post uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public.require_user();
  pst public.posts%rowtype;
begin
  select * into pst from public.posts where id = p_post;
  if not found then
    raise exception '投稿が見つかりません';
  end if;
  if pst.hidden then
    raise exception 'この投稿にはいいねできません';
  end if;
  if pst.author_id = u then
    raise exception '自分の投稿にはいいねできません';
  end if;
  delete from public.post_likes where post_id = p_post and user_id = u;
  if found then
    perform public.add_points(pst.author_id, -public.rule_pts('like'), 'いいねの取り消し');
    return false;
  end if;
  insert into public.post_likes (post_id, user_id) values (p_post, u) on conflict do nothing;
  perform public.add_points(pst.author_id, public.rule_pts('like'), 'いいねをもらった');
  return true;
end $$;

-- ベストアンサー: スレッドを立てた本人だけ。同じ投稿をもう一度選ぶと取り消し(選んだら true)
create or replace function public.set_best(p_thread uuid, p_post uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public.require_user();
  t public.threads%rowtype;
  pst public.posts%rowtype;
  prev_author uuid;
begin
  select * into t from public.threads where id = p_thread for update;
  if not found then
    raise exception 'スレッドが見つかりません';
  end if;
  if t.author_id <> u then
    raise exception 'ベストアンサーを選べるのはスレッドを立てた人だけです';
  end if;
  select * into pst from public.posts where id = p_post;
  if not found or pst.thread_id <> t.id or pst.is_op then
    raise exception 'この投稿はベストアンサーにできません';
  end if;
  if pst.hidden then
    raise exception '非表示の投稿は選べません';
  end if;
  if pst.author_id = u then
    raise exception '自分の投稿はベストアンサーにできません';
  end if;
  if t.best_post_id is not null then
    select author_id into prev_author from public.posts where id = t.best_post_id;
    if prev_author is not null then
      perform public.add_points(prev_author, -public.rule_pts('best'), 'ベストアンサーの取り消し');
    end if;
  end if;
  if t.best_post_id = p_post then
    update public.threads set best_post_id = null where id = t.id;
    return false;
  end if;
  update public.threads set best_post_id = p_post where id = t.id;
  perform public.add_points(pst.author_id, public.rule_pts('best'), 'ベストアンサーに選ばれた');
  return true;
end $$;

-- 通報。規定数に達した投稿は自動で非表示にする
create or replace function public.report_post(p_post uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public.require_user();
  pst public.posts%rowtype;
  n integer;
begin
  select * into pst from public.posts where id = p_post;
  if not found then
    raise exception '投稿が見つかりません';
  end if;
  if pst.author_id = u then
    raise exception '自分の投稿は通報できません';
  end if;
  insert into public.post_reports (post_id, user_id, reason)
    values (p_post, u, left(coalesce(nullif(btrim(p_reason), ''), 'その他'), 40))
    on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'この投稿はすでに通報済みです';
  end if;
  select count(*) into n from public.post_reports where post_id = p_post;
  if n >= public.rule_pts('hide_at') then
    update public.posts set hidden = true, auto_hidden = true where id = p_post and not hidden;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 公開関数(RPC): 管理者用(関数の中で管理者かどうかを必ず確認する)
-- ---------------------------------------------------------------------

create or replace function public.admin_list_reported() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(s.x order by s.rc desc, s.ca desc), '[]'::jsonb)
    from (
      select
        jsonb_build_object(
          'id', p.id,
          'threadId', p.thread_id,
          'threadTitle', t.title,
          'body', p.body,
          'hidden', p.hidden,
          'autoHidden', p.auto_hidden,
          'penalty', p.penalty,
          'author', jsonb_build_object('id', a.id, 'nickname', a.nickname, 'points', a.points),
          'reasons', coalesce((select jsonb_agg(r.reason order by r.created_at)
                               from public.post_reports r where r.post_id = p.id), '[]'::jsonb),
          'createdAt', public.ms(p.created_at)
        ) as x,
        (select count(*) from public.post_reports r where r.post_id = p.id) as rc,
        p.created_at as ca
      from public.posts p
      join public.threads t on t.id = p.thread_id
      join public.profiles a on a.id = p.author_id
      where p.hidden or exists (select 1 from public.post_reports r where r.post_id = p.id)
    ) s
  );
end $$;

create or replace function public.admin_hide_post(p_post uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pst public.posts%rowtype;
  t public.threads%rowtype;
  delta integer;
begin
  perform public.require_admin();
  select * into pst from public.posts where id = p_post;
  if not found then
    raise exception '投稿が見つかりません';
  end if;
  update public.posts set hidden = true, auto_hidden = false where id = p_post;
  if pst.penalty = 0 then
    delta := public.add_points(pst.author_id, -public.rule_pts('penalty'), '投稿が非表示になった');
    update public.posts set penalty = -delta where id = p_post;
  end if;
  select * into t from public.threads where id = pst.thread_id;
  if found and t.best_post_id = p_post then
    update public.threads set best_post_id = null where id = t.id;
    perform public.add_points(pst.author_id, -public.rule_pts('best'), 'ベストアンサーの取り消し');
  end if;
end $$;

create or replace function public.admin_restore_post(p_post uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pst public.posts%rowtype;
begin
  perform public.require_admin();
  select * into pst from public.posts where id = p_post;
  if not found then
    raise exception '投稿が見つかりません';
  end if;
  update public.posts set hidden = false, auto_hidden = false, penalty = 0 where id = p_post;
  delete from public.post_reports where post_id = p_post;
  if pst.penalty > 0 then
    perform public.add_points(pst.author_id, pst.penalty, '非表示の取り消し');
  end if;
end $$;

create or replace function public.admin_get_ng_words() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  return (select coalesce(jsonb_agg(word order by word), '[]'::jsonb) from public.ng_words);
end $$;

create or replace function public.admin_set_ng_words(p_words text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  delete from public.ng_words where true;
  insert into public.ng_words (word)
    select distinct btrim(w) from unnest(coalesce(p_words, '{}'::text[])) as w where btrim(w) <> ''
    on conflict do nothing;
end $$;


-- ---------------------------------------------------------------------
-- 権限: ブラウザ(anon / authenticated)から使えるものだけを許可する
-- ---------------------------------------------------------------------

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- 未ログインでも使える(閲覧・登録前の確認)
grant execute on function public.list_threads()             to anon, authenticated;
grant execute on function public.get_thread(uuid)           to anon, authenticated;
grant execute on function public.ranking(text)              to anon, authenticated;
grant execute on function public.get_me()                   to anon, authenticated;
grant execute on function public.nickname_available(text)   to anon, authenticated;

-- ログインが必要
grant execute on function public.my_profile()                       to authenticated;
grant execute on function public.daily_bonus()                      to authenticated;
grant execute on function public.create_thread(text, text, text)   to authenticated;
grant execute on function public.create_reply(uuid, text)          to authenticated;
grant execute on function public.toggle_like(uuid)                 to authenticated;
grant execute on function public.set_best(uuid, uuid)              to authenticated;
grant execute on function public.report_post(uuid, text)           to authenticated;

-- 管理者(関数内でも管理者かどうかを確認する)
grant execute on function public.admin_list_reported()             to authenticated;
grant execute on function public.admin_hide_post(uuid)             to authenticated;
grant execute on function public.admin_restore_post(uuid)          to authenticated;
grant execute on function public.admin_get_ng_words()              to authenticated;
grant execute on function public.admin_set_ng_words(text[])        to authenticated;
