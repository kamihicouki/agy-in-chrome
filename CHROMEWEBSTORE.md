# Chrome Web Store 掲載情報

更新日: 2026-11-16

| 項目 | 入力内容 |
|---|---|
| 名前 | Antigravity Remote Sidebar |
| 短い説明 | Open Antigravity from Chrome and prepare context from your current tab. |
| カテゴリ | Developer Tools |
| 言語 | 日本語 |
| 公開範囲 | 公開 |
| 単一の目的 | 現在の Chrome タブの文脈を用意し、Antigravity の公式 Web アプリを開く。 |
| アイコン | `icons/128.png` |
| スクリーンショット | `store/side-panel.png`（640×400） |
| プライバシーポリシー | https://github.com/kamihicouki/antigravity-sidebar/blob/main/PRIVACY.md |
| サポート | https://github.com/kamihicouki/antigravity-sidebar/issues |

## 詳細説明

閲覧中のページを残したまま、Antigravity の公式 Web アプリを隣に表示できます。

Chrome のツールバーからサイドバーを開き、分割表示、別タブ、別ウィンドウを選べます。「タブの情報を取得」でタイトル、URL、選択テキストを確認できます。チェックを入れると表示領域のテキストも含まれます。「コピーして開く」を押し、公式画面の入力欄に貼り付けてください。

この拡張は非公式です。Google による提供・承認は受けていません。

## 審査とプライバシー

- `sidePanel` はツールバーから起動パネルを表示するために使います。
- `storage` は表示方法の設定を端末に保存します。
- `activeTab` と `scripting` は、利用者が指定したタブの情報を取得し、共有する文脈をプレビューに表示するために使います。
- 取得内容はサイドパネルと明示操作時のクリップボードで処理します。拡張からの外部送信、履歴保存、分析はありません。
- 審査ではサイドパネルと分割表示まで確認できます。公式 Remote Control の確認には別途 Google アカウントと接続済みの端末が必要です。

| バージョン | 変更 | 状態 |
|---|---|---|
| 0.3.0 | 表示方法と閲覧タブの文脈共有 | 初回申請候補 |
| 0.2.1 | ストア用アイコンと初回配布パッケージ | 初回申請用 |
