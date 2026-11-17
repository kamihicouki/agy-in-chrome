# Chrome Web Store への公開

初回は [開発者ダッシュボード](https://chrome.google.com/webstore/devconsole) で ZIP をアップロードして項目を作り、掲載情報とプライバシー情報を入力します。公開を選び、審査通過後に自動公開する設定で送信します。掲載情報は [CHROMEWEBSTORE.md](../CHROMEWEBSTORE.md) にあります。ZIP は GitHub Releases から取得するか、`python3 scripts/package.py` で生成します。初回の項目作成は Web Store API の対象外です。

## GitHub Actions を有効にする

1. Google Cloud で Chrome Web Store API を有効にし、更新専用サービスアカウントを作ります。ストアの開発者ダッシュボードのアカウント設定で、そのサービスアカウントにアクセスを与えます。[公式手順](https://developer.chrome.com/docs/webstore/service-accounts)
2. Google Cloud の Workload Identity Federation で GitHub Actions を設定します。属性条件で、このリポジトリの ID と `assertion.ref == 'refs/heads/production'` に限定し、対象サービスアカウントの偽装権限をこのリポジトリの ID にだけ付与します。OAuth アクセストークン生成に必要なサービスアカウントの権限は、認証アクションの手順を参照してください。[GitHub Actions 公式ガイド](https://docs.github.com/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-google-cloud-platform) · [認証アクション](https://github.com/google-github-actions/auth)
3. GitHub の `chrome-web-store` 環境に下記の変数を設定します。環境のデプロイ対象も `production` に限定します。

| 変数 | 内容 |
|---|---|
| `CWS_WORKLOAD_IDENTITY_PROVIDER` | Google Cloud の Workload Identity Provider のリソース名 |
| `CWS_SERVICE_ACCOUNT` | ストアへ登録したサービスアカウントのメールアドレス |
| `CWS_PUBLISHER_ID` | ダッシュボードの Publisher ID |
| `CWS_EXTENSION_ID` | 初回アップロードで割り当てられた拡張 ID |

初回審査中でも、`production` でワークフローを手動実行し、既定の `verify_access` を選ぶと接続を確認できます。サービスアカウントで対象アイテムの公開版と審査版を読み取り、結果を Actions ログに記録します。この実行は ZIP のアップロードや審査申請を行いません。

初回版が公開されたら、リポジトリの変数 `CWS_PUBLISH_ENABLED` を `true` にします。更新 PR では `manifest.json` のバージョンを上げ、掲載情報の履歴を更新してから `production` にマージしてください。マージによる push を受け、Actions が ZIP を検証、アップロードし、審査を申請します。Google の審査を通過すると自動で公開されます。審査中に別版をマージした場合は、審査完了後に最新の `production` で `verify_access` を外して手動実行してください。
