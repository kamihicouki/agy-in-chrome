# Chrome Web Store 掲載情報

更新日: 2026-11-16

| 項目 | 入力内容 |
|---|---|
| 名前 | agy in chrome |
| 読み方 | antigravity in chrome |
| 短い説明 | Open Desktop conversations in Antigravity Remote Control or chat with the local CLI from Chrome. |
| カテゴリ | Developer Tools |
| 言語 | 日本語 |
| 公開範囲 | 公開 |
| 単一の目的 | Chrome から Antigravity の会話に入り、サイドバー内の CLI 会話に現在のタブを添付する。 |
| アイコン | `icons/128.png` |
| スクリーンショット | 0.4.0 の会話画面で要更新 |
| プライバシーポリシー | https://github.com/kamihicouki/agy-in-chrome/blob/main/PRIVACY.md |
| サポート | https://github.com/kamihicouki/agy-in-chrome/issues |

## 詳細説明

agy in chrome（読み方は antigravity in chrome）は、Chrome のサイドパネルから、公式 Remote Control で Desktop の既存会話を開けます。現在のタブを添付してサイドバー内で会話するには、ローカル CLI と中継を別途セットアップします。

この拡張は非公式です。Google による提供・承認は受けていません。

## 審査とプライバシー

- `sidePanel` はツールバーから起動パネルを表示するために使います。
- `storage` は利用者が保存した Remote Control リンクをこの Chrome に保持します。
- `nativeMessaging` はローカルの Antigravity CLI と会話するために使用します。中継の登録は利用者が行います。
- `activeTab` と `scripting` は、利用者が指定したタブの情報を取得し、共有する文脈をプレビューに表示するために使います。
- 送信操作で会話と選択した資料をローカル CLI に渡します。CLI 経由のデータ処理はプライバシーポリシーを参照してください。
- 初回申請時は、中継の導入手順と CLI 実行環境をレビュー担当者に案内します。

| バージョン | 変更 | 状態 |
|---|---|---|
| 0.4.1 | Desktop の既存会話を既定の入口にし、公式リンクの保存を追加 | 開発版 |
| 0.4.0 | サイドパネル内の会話とローカル ACP 接続 | 開発版 |
| 0.3.1 | 名称を agy in chrome に変更 | 初回申請候補 |
| 0.3.0 | 表示方法と閲覧タブの文脈共有 | 初回申請候補 |
| 0.2.1 | ストア用アイコンと初回配布パッケージ | 初回申請用 |
