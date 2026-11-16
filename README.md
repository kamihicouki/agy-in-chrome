# agy in chrome

読み方は「antigravity in chrome」です。Chrome のサイドパネルから公式 Antigravity Remote Control のビューを開き、閲覧中のタブから会話用の資料を作れる非公式拡張です。

## 公式ビューを開く

1. Antigravity Desktop で Remote Control を有効にし、Chrome の公式 Web で同じ Google アカウントにログインします。
2. Chrome 157 以降で拡張アイコンを押すと、Google の公式サイトがサイドパネルのメインコンテンツとして開きます。公式画面で端末と会話を選びます。
3. 公式の端末・会話 URL は、資料パネルにある「接続先リンク」に保存できます。

[Google 公式手順](https://antigravity.google/docs/remote-control/)

## ページ資料を会話に使う

共有元のページを右クリックし、「選択範囲とページ情報を Antigravity 用にコピー」または「表示中のページ資料を Antigravity 用にコピー」を選びます。コピーが成功すると拡張アイコンに ✓ が出ます。サイドパネルで開いている公式会話の入力欄に貼り付けてください。

ファイルとして添付する場合は、共有元を右クリックして「ページ資料を Antigravity 添付用ファイルに保存」を選び、公式パネルで「Add context → Files」を開いて `antigravity-page-context.md` を選びます。

送る前に資料を編集したい場合は、拡張アイコンを右クリックし、「接続先・資料プレビュー」を選びます。公式画面から資料プレビューに切り替えると、サイドパネルが読み直されます。

## 開発版を読み込む

Chrome の拡張機能管理画面で、デベロッパー モードを有効にします。「パッケージ化されていない拡張機能を読み込む」で、リポジトリのルートか配布 ZIP の展開先を選びます。更新時は公式ビューを閉じ、対象の拡張カードで再読み込みします。

配布版と公開手順は [GitHub Releases](https://github.com/kamihicouki/agy-in-chrome/releases) と [Chrome Web Store 公開手順](docs/store-release.md) を参照してください。
