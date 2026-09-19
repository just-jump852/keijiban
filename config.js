// Supabase の接続情報。
//
// ここに書いてよいのは、公開されても安全な次の2つだけです。
//   supabaseUrl     : Project URL  (例: https://xxxxxxxxxxxx.supabase.co)
//   supabaseAnonKey : anon キー、または publishable キー (sb_publishable_... / eyJ...)
//
// service_role キー / secret キーは強い権限を持つので、絶対にここへ書かないでください。
// 手順は supabase/セットアップ手順.md を参照。
window.KEIJIBAN_CONFIG = {
  supabaseUrl: 'https://mcmuagvjxjnjoskozxqv.supabase.co',
  supabaseAnonKey: 'sb_publishable_SaPS6AMeFKvSX2Zx13S96Q_PztsuS-q',
};
