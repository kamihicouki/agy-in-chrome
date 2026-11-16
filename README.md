# agy in chrome

読み方は「antigravity in chrome」です。

Chrome のサイドパネルから公式 Antigravity を開き、閲覧中のタブの文脈を共有できる非公式の拡張です。公式画面の開き方は分割表示、別タブ、別ウィンドウから選べます。

1. 共有元のページで拡張アイコンを押します。
2. 「タブの情報を取得」でタイトル、URL、選択テキストをプレビューします。表示領域のテキストも必要なら、チェックを入れて取得します。
3. 内容を確認し、「コピーして開く」を押して、公式画面の入力欄に貼り付けます。

分割表示は Chrome 155 以降です。分割できない場合は別ウィンドウまたは別タブで開きます。

- **Remote Conversations** は Google が管理する環境で実行する会話です。[Remote Agents 公式ガイド](https://antigravity.google/docs/remote-agents/)
- **Remote Control Instances** は接続済みの Antigravity App または CLI が動くマシンです。CLI は会話を直接開くリンクも出力します。[Remote Control 公式ガイド](https://antigravity.google/docs/remote-control/)

公式サイトの公開 Web App Manifest は `start_url: "/"`、`display: "standalone"` です。[公開マニフェスト](https://antigravity.google.com/assets/manifest.json)

0.1.x の iframe 試作では、ログイン済みの Chrome でも Google が 403 を返す例を確認しました。0.2.0 は Chrome の Split View を使い、公式サイトを通常のタブとして開きます。[Split View API](https://developer.chrome.com/blog/split-view-api-extensions)

配布 ZIP は [GitHub Releases](https://github.com/kamihicouki/agy-in-chrome/releases) にあります。Chrome Web Store の初回申請と自動更新の設定は [公開手順](docs/store-release.md) を参照してください。
