# vendor/

外部ライブラリを、CDN に頼らずこのリポジトリに同梱しています。

| ファイル | 内容 | 入手元 |
|---|---|---|
| `supabase-js.umd.js` | `@supabase/supabase-js` v2.116.0 のブラウザ用ビルド(`dist/umd/supabase.js`) | npm レジストリ公式の配布物 |
| `supabase-js.LICENSE` | 上記のライセンス(MIT) | 同上 |

## 更新するとき

1. `https://registry.npmjs.org/@supabase/supabase-js/latest` で最新版の `dist.tarball` と `dist.integrity` を確認する
2. tarball をダウンロードし、SHA-512 が `dist.integrity` と一致することを確認する
3. 展開して `package/dist/umd/supabase.js` を `supabase-js.umd.js` に置き換える
4. 上の表のバージョンを更新する
