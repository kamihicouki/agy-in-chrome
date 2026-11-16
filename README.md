# agy in chrome

読み方は「antigravity in chrome」です。Chrome のサイドパネルでローカルの Antigravity CLI と会話し、開いているタブを資料に添えられる非公式拡張です。

## セットアップ

macOS または Linux の Google Chrome、Node.js、Python 3、Antigravity CLI が必要です。Antigravity CLI でログインしてから、ソースを使って中継を登録します。[公式 ACP 手順](https://antigravity.google/docs/cli/acp)

1. `python3 scripts/package.py` で ZIP を作り、展開したフォルダを Chrome の拡張機能管理画面から読み込みます。
2. 拡張 ID をコピーし、このリポジトリのソースディレクトリで次を実行します。

   ```sh
   python3 scripts/install-native.py EXTENSION_ID
   ```

3. 共有元のページで拡張アイコンを押し、サイドパネルで「Antigravity に接続」を選びます。

登録スクリプトは、この拡張 ID だけを許可し、専用作業フォルダ `~/.agy-in-chrome/workspace` で `agy acp --sandbox --disable-telemetry` を起動する中継を登録します。作業単位のフォルダは `--workspace /absolute/path/to/workspace` で選べます。CLI の既存設定で許可済みの操作は、承認なしで実行される場合があります。Chrome for Testing は `--chrome-for-testing`、カスタムユーザーデータディレクトリは `--user-data-dir` を指定できます。ソースを移動した場合は登録をやり直してください。

## 使い方

「＋」から現在のタブと選択した文章、または表示領域のテキストを添付できます。チップを押して送る内容を確認し、不要なら外せます。送信すると、資料はプロンプト内の引用として CLI に渡ります。実行中は「停止」で中止を要求できます。

会話の一覧と下書きはパネルを開いている間に保持します。ローカル CLI に承認が必要な操作を求められた場合、この版は拒否して通知します。CLI の既存会話の再開や、公式 Web の Remote Agents／Remote Control セッションの同期は未対応です。公式 Web 画面はオプションから分割表示、別タブ、別ウィンドウで開けます。

配布版と公開手順は [GitHub Releases](https://github.com/kamihicouki/agy-in-chrome/releases) と [Chrome Web Store 公開手順](docs/store-release.md) を参照してください。
