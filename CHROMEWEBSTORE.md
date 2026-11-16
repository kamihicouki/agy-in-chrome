# Chrome Web Store 掲載情報

更新日: 2026-11-16

| 項目 | 入力内容 |
|---|---|
| 名前 | agy in chrome |
| 読み方 | antigravity in chrome |
| 短い説明 | Talk to Antigravity in the Chrome side panel with context from the current tab. |
| カテゴリ | Developer Tools |
| 言語 | 日本語 |
| 公開範囲 | 公開 |
| 単一の目的 | Chrome のサイドパネルで Antigravity CLI と会話し、現在のタブを参考資料に添付する。 |
| アイコン | `icons/128.png` |
| スクリーンショット | 0.4.0 の会話画面で要更新 |
| プライバシーポリシー | https://github.com/kamihicouki/agy-in-chrome/blob/main/PRIVACY.md |
| サポート | https://github.com/kamihicouki/agy-in-chrome/issues |

## 詳細説明

agy in chrome（読み方は antigravity in chrome）は、閲覧中のタブを資料に添えて Chrome のサイドパネルからローカルの Antigravity CLI に依頼できる拡張です。別途 CLI とローカル中継のセットアップが必要です。

この拡張は非公式です。Google による提供・承認は受けていません。

## 審査とプライバシー

- `sidePanel` はツールバーから起動パネルを表示するために使います。
- `nativeMessaging` はローカルの Antigravity CLI と会話するために使用します。中継の登録は利用者が行います。
- `activeTab` と `scripting` は、利用者が指定したタブの情報を取得し、共有する文脈をプレビューに表示するために使います。
- 送信操作で会話と選択した資料をローカル CLI に渡します。CLI 経由のデータ処理はプライバシーポリシーを参照してください。
- 初回申請時は、中継の導入手順と CLI 実行環境をレビュー担当者に案内します。

| バージョン | 変更 | 状態 |
|---|---|---|
| 0.4.0 | サイドパネル内の会話とローカル ACP 接続 | 開発版 |
| 0.3.1 | 名称を agy in chrome に変更 | 初回申請候補 |
| 0.3.0 | 表示方法と閲覧タブの文脈共有 | 初回申請候補 |
| 0.2.1 | ストア用アイコンと初回配布パッケージ | 初回申請用 |
