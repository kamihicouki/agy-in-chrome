# Antigravity Remote Sidebar

Chrome のサイドパネルから、Google Antigravity の公式 Web アプリを現在のタブの隣に開く非公式の試作です。サイドパネルは起動用で、会話や接続先の切り替えは分割表示内の公式画面で行います。

拡張を読み込んでツールバーのアイコンを押し、「隣に開く」を選びます。分割表示の起動には Chrome 155 以降が必要です。「別タブで開く」も使えます。古い試作を読み込んでいる場合は、拡張機能管理画面で更新してください。

- **Remote Conversations** は Google が管理する環境で実行する会話です。[Remote Agents 公式ガイド](https://antigravity.google/docs/remote-agents/)
- **Remote Control Instances** は接続済みの Antigravity App または CLI が動くマシンです。CLI は会話を直接開くリンクも出力します。[Remote Control 公式ガイド](https://antigravity.google/docs/remote-control/)

公式サイトの公開 Web App Manifest は `start_url: "/"`、`display: "standalone"` です。[公開マニフェスト](https://antigravity.google.com/assets/manifest.json)

0.1.x の iframe 試作では、ログイン済みの Chrome でも Google が 403 を返す例を確認しました。0.2.0 は Chrome の Split View を使い、公式サイトを通常のタブとして開きます。拡張が要求する権限は `sidePanel` だけです。[Split View API](https://developer.chrome.com/blog/split-view-api-extensions)

配布 ZIP は [GitHub Releases](https://github.com/kamihicouki/antigravity-sidebar/releases) にあります。Chrome Web Store の初回申請と自動更新の設定は [公開手順](docs/store-release.md) を参照してください。
