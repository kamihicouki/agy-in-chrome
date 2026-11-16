# 公式会話でページ資料を参照する MCP 試作

指定した Markdown と任意の PNG を、ローカルの MCP ツール `read_page_context_fixture` で返します。起動時に指定した2ファイルを読み込み、ツール呼び出し時の引数は空です。変更したファイルを読み込むにはサーバーを再起動します。配布拡張から独立した実験です。

## テスト資料の用意

1. サインインしていない隔離 Chrome プロファイルで公開のテストページを開きます。
2. 本文は agy in chrome のページ資料を Markdown として保存します。画像は隔離環境専用の Chrome DevTools MCP の `take_screenshot` で PNG として保存できます。アクセシビリティツリーの `take_snapshot` と本文 Markdown は別の資料として扱います。
3. Markdown は UTF-8 で 128 KiB 以下、PNG は 4 MiB 以下にします。使い捨てディレクトリに公開テスト資料だけを置きます。

Chrome DevTools MCP を使う場合は、専用のブラウザを起動する `--isolated` を使い、そのブラウザ内で公開ページを開きます。[Chrome DevTools MCP の設定](https://github.com/ChromeDevTools/chrome-devtools-mcp#configuration) · [ツール一覧](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md)

## Antigravity から試す

Remote Control で接続するホストの Antigravity App に、新規のテスト用ワークスペースを開きます。そのワークスペースの `.agents/mcp_config.json` に次のエントリを追加し、実際の絶対パスに置き換えます。画像の試験を省く場合は PNG の引数を外します。[Antigravity MCP の設定](https://antigravity.google/docs/mcp)

```json
{
  "mcpServers": {
    "agy-page-context-fixture": {
      "command": "node",
      "args": [
        "/absolute/path/agy-in-chrome/experiments/mcp-context/server.mjs",
        "/absolute/path/fixtures/page.md",
        "/absolute/path/fixtures/page.png"
      ],
      "enabledTools": ["read_page_context_fixture"]
    }
  }
}
```

Remote Control のテスト会話で、次の二つを別々に確認します。

1. **送信前**。公式 Add context を開き、MCP の資料を添付チップとして追加できる入口が表示されるか観察します。
2. **送信後**。公開テスト資料だけを使う専用会話で、利用者が `read_page_context_fixture` の利用を依頼し、返された本文の目印と画像の内容をエージェントが参照できるか確認します。

ローカルの検証は `node --test experiments/mcp-context/server.test.mjs` で実行します。このテストは Antigravity の会話に接続せず、stdio の初期化と資料返却を確認します。
