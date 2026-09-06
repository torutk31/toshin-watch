# 投信ウォッチ

SBI証券の公開「基準価額」ページから13本の投資信託のデータを取得し、iPhoneでも見やすい一覧ページに表示するサンプルです。ブラウザを開いていなくても、GitHub Actionsが毎日5:00（日本時間）に`data/funds.json`を更新します。

## 表示する内容

- 直近基準価額と日付
- 前日比
- 前月同日比・前年同日比
  - 比較日の基準価額が未掲載の日は、比較日の直前に掲載された日を使います。
- SBI証券の基準価額詳細・履歴ページへのリンク

SBI証券の公開ページで確認できる「基準価額」履歴を、取得元とリンク先に使用します。`チャート`ボタンも同じ公開履歴ページを開きます。ログイン状態やSBI証券側の画面仕様に依存しない、公開状態で検証済みのリンクにするためです。

## 最初に一度だけ行うこと

1. このフォルダを新しいGitHubリポジトリにアップロードします。
2. GitHubリポジトリの **Settings → Actions → General → Workflow permissions** で **Read and write permissions** を選び、保存します。
3. **Actions → 投信データを更新 → Run workflow** を実行します。
4. `data/funds.json`が更新されたら、GitHub Pagesを有効にします。
   - **Settings → Pages → Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: `main` / folder: `/(root)`
5. 表示されたPages URLをiPhoneのSafariで開き、必要なら「ホーム画面に追加」します。

> GitHub ActionsのcronはUTCで指定するため、ワークフローは`0 20 * * *`（翌日05:00 JST）です。GitHubの定時実行は混雑時に遅れて開始することがあります。

## 手元で更新を試す

Node.js 20以降があるPCで、フォルダ直下から実行します。

```powershell
node scripts/update-funds.mjs
```

`index.html`はJSONを読み込むため、`file:///`で直接開かず、Webサーバー経由で確認します。例えばNode.jsがある場合は次のようにします。

```powershell
npx serve .
```

表示されたアドレスをブラウザで開いてください。

## 銘柄の変更

`data/fund-config.json`の各銘柄を編集します。SBI証券の公開基準価額URL末尾の`fund_sec_code`を`fundSecCode`に設定してください。

フランクリン・テンプルトン・アメリカ地方債ファンドは、為替ヘッジ・分配型の別があります。このサンプルは「為替ヘッジなし（隔月分配）」を選択しています。お持ちの型が異なる場合は、同ファイルの該当行だけを変更してください。

## 取得元と注意

- 取得元: SBI証券「投資信託 基準価額」公開ページ
- SBI証券ページ内の注記: 基準価額・純資産総額はウエルスアドバイザー社提供
- データ取得元の画面や利用条件が変わった場合は、`scripts/update-funds.mjs`の解析処理を見直してください。
- このサンプルは個人の情報確認用途を想定しています。投資判断はご自身の責任で行ってください。
