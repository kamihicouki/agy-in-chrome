# Chrome Web Store 掲載情報

更新日: 2026-11-16

| 項目 | 入力内容 |
|---|---|
| 名前 | agy in chrome |
| 読み方 | antigravity in chrome |
| 短い説明 | Open the official Antigravity Remote Control in the Chrome side panel. |
| カテゴリ | Developer Tools |
| 言語 | 日本語 |
| 公開範囲 | 公開 |
| 単一の目的 | Chrome から公式 Antigravity Remote Control を開き、閲覧タブの資料を用意する。 |
| アイコン | `icons/128.png` |
| スクリーンショット | 0.5.0 のビューと資料プレビューで要更新 |
| プライバシーポリシー | https://github.com/kamihicouki/agy-in-chrome/blob/main/PRIVACY.md |
| サポート | https://github.com/kamihicouki/agy-in-chrome/issues |

## 詳細説明

agy in chrome（読み方は antigravity in chrome）は、Chrome のサイドパネルから、公式 Remote Control で Desktop の既存会話を開けます。Chrome 157 以降では、公式画面を Chrome のサイドパネルに表示します。閲覧中のタブから資料を取り出して確認・コピーし、公式画面の入力欄に貼り付けられます。

この拡張は非公式です。Google による提供・承認は受けていません。

## 審査とプライバシー

- `sidePanel` はツールバーから起動パネルを表示するために使います。
- `contextMenus` は拡張アイコンのメニューに資料の入口を表示するために使います。
- `clipboardWrite` は右クリックメニューから利用者が指定したページ資料をコピーするために使います。
- `storage` は利用者が保存した Remote Control リンクをこの Chrome に保持します。
- `activeTab` と `scripting` は、利用者が指定したタブの情報を取得し、共有する文脈をプレビューに表示するために使います。

| バージョン | 変更 | 状態 |
|---|---|---|
| 0.6.3 | 入力欄の追加ボタンを削除し、ページ資料に画像リンクを含める | 非公開開発版 |
| 0.6.2 | サイドパネルのフォーカス判定を見直し、接続状態を診断 | 非公開開発版 |
| 0.6.1 | 公式サイドパネルで閲覧中のページを一度の操作で下書きに追加 | 非公開開発版 |
| 0.6.0 | 公式 Add context 向けの直接添付と下書き挿入の試作 | 非公開開発版 |
| 0.5.2 | 公式会話を開いたまま、閲覧ページの右クリックから資料をコピー・添付用ファイルとして保存 | 開発版 |
| 0.5.1 | 公式ビューをサイドパネルとして直接開く | 検証版 |
| 0.5.0 | 公式ビューの再利用とページ資料プレビュー・コピー | 暫定開発版 |
| 0.4.1 | Desktop の既存会話を既定の入口にし、公式リンクの保存を追加 | 開発版 |
| 0.4.0 | サイドパネル内の会話とローカル ACP 接続 | 開発版 |
| 0.3.1 | 名称を agy in chrome に変更 | 初回申請候補 |
| 0.3.0 | 表示方法と閲覧タブの文脈共有 | 初回申請候補 |
| 0.2.1 | ストア用アイコンと初回配布パッケージ | 初回申請用 |
