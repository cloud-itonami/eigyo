# eigyo

営業パイプライン（lead → deal → 成約時のオンチェーン決済）の **kotoba 参照実装**。
TypeScript 6 ファイル + vitest スイート 1 本。`cloud-itonami/eigyo`。

2026-05-21 に `etzhayyim/root` の `60-apps/etzhayyim-project-eigyo` から
seed として切り出されたもので、`MIGRATION-TODO.md` が言うとおり
**まだ TRANSFORM 途中**（codemod 未適用）。下の「いま実際に動くもの」を
先に読んでほしい —— このディレクトリを開いた人が最初に踏む
`pnpm install` は、**この repo では通らない**。

操作手順は **[`docs/operator-quickstart.md`](docs/operator-quickstart.md)**。
そちらは実際に踏める形で書いてある（踏めなかった手順は載せていない）。

## いま実際に動くもの（2026-08-19 実測、commit `5038d10`）

| やりたいこと | 結果 |
|---|---|
| ドメインロジックを動かす（lead / deal / stage / 決済 orchestration / tithe） | **動く。npm install 不要** |
| `pnpm install` | **通らない**（2 段で落ちる。quickstart step 2） |
| `pnpm test`（= `vitest run`、`kotoba/test/eigyo.test.ts`） | **走らない**（install に依存） |
| `pnpm typecheck`（= `tsc --noEmit`） | **通らない**（`@etzhayyim/sdk` の型が無い。7 error） |
| `https://eigyo.etzhayyim.com/` | **DNS が解決しない** |

**install 無しで動く理由**は、この repo の依存の張り方にある:

| ファイル | `@etzhayyim/sdk` の参照 | 実行時に要るか |
|---|---|---|
| `src/types.ts` | 無し | いいえ |
| `src/tithe.ts` | 無し | いいえ |
| `src/lead.ts` | `import type { Etzhayyim }` | **いいえ**（型は消える） |
| `src/deal.ts` | `import type { Etzhayyim }` | **いいえ**（型は消える） |
| `src/settlement.ts` | `import { donate }` | **はい** |
| `src/index.ts` | 上記を再輸出 | はい（settlement 経由） |

つまり SDK を実行時に本当に要求するのは **`settlement.ts` 1 本だけ**で、
それは「`donate()` を `SettlementExecutor` の形に包む」だけの薄いアダプタである。
lead / deal は `Etzhayyim` を**型としてしか**使っていないので、`read`/`write` の
2 メソッドを持つ値を渡せばそのまま動く。パイプライン全体を install 無しで
歩ける（quickstart step 4 が実際にそうする）。

逆に、**committed のテストスイートはこの経路に乗らない** ——
`test/eigyo.test.ts` は `../src/index.js`（→ `settlement.ts` → SDK）と
`@etzhayyim/sdk-mock` を実行時に import するので、install が通らない限り走らない。

## ドメイン

```
lead  ──────────────▶ deal ──▶ stage 遷移 ──▶ won ──▶ settleDeal ──▶ payment
                                                          │
                                              SettlementExecutor（注入）
```

- **lead** — `createLead` / `getLead` / `listLeads`。`status` は
  `new | working | qualified | disqualified`（作成時は必ず `new`）。
- **deal** — `createDeal` / `getDeal` / `listDeals` / `advanceDeal`。
  stage は `prospecting | proposal | negotiation | won | lost`。
  作成時は必ず `prospecting`。**`won` / `lost` は終端**で、そこからは動かせない
  （`dealTerminal:<stage>` で拒否）。
- **settleDeal** — `won` の deal だけを決済する。`txHash` が既にあれば
  `alreadySettled`（冪等）。payment レコードを書き、deal に `txHash` を刻む。
- **tithe** — `splitTithe` が 10%（`TITHE_PERMILLE = 100n` / 1000）を
  **整数切り捨て**で分ける。端数の漏れは無い（`gross - tithe - net === 0`）。

レコードは AT PDS の 3 コレクションに載る:

```
com.etzhayyim.apps.eigyo.lead      rkey: lead-<leadId 小文字>
com.etzhayyim.apps.eigyo.deal      rkey: deal-<dealId 小文字>
com.etzhayyim.apps.eigyo.payment   rkey: payment-<dealId 小文字>
```

金額はすべて **USDC の micros（10^-6）を 10 進文字列**で持ち、計算は `bigint`。
`parseMicros` は非負整数文字列以外を `TypeError` で弾く（`"-1"` も `"1.5"` も）。

## 知っておくべき挙動（実測）

1. **`settleDeal` が executor に渡すのは gross であって net ではない。**
   240 USDC の deal で executor が受け取るのは `240000000n` で、
   `tithe=24000000` / `net=216000000` は **payment レコードの中にしか無い**。
   分割そのものは `donate()` の先の TitheRouter がやる前提になっている。
   ⚠ **TitheRouter を通らない executor を注入すると、tithe は起きないのに
   payment レコードは「分けた」と主張する。** テストの `fakeSettle` も
   quickstart の walk も、まさにこの形（受け取った額を無視して txHash を返すだけ）。
2. **`leadId` / `dealId` は大小文字を畳む。** `dealRkey` と `dealDid` が
   `toLowerCase()` するので `D-1` と `d-1` は**同じ deal**（2 本目は
   `alreadyExists`）。一方 `dealId` フィールドには渡した通りの表記が残るので、
   レコードの中身と rkey の表記は一致しないことがある。
3. **10 micros 未満の deal の tithe は 0。** 切り捨てなので `gross=9` → `tithe=0`。
   漏れではなく、丸めの向きが受益者（payee）側という設計。
4. **`listLeads` / `listDeals` の絞り込みはページ内だけ。** `read` が返した
   1 ページに対して filter をかけてから `total` を数えるので、
   `total` は「全件数」ではなく「このページで条件に合った数」。
   `limit` の既定は 50、上限 200。

## 裏取りできなかった記述（この README が旧版から落としたもの）

旧 README は次を宣言していたが、いずれも**裏付けを見つけられなかった**
（`etzhayyim/root` は remote main `0ba7feca` と一致した full-history checkout で確認）:

- `Export: etzhayyim:apqc/business-capabilities@0.1.0` ほか **WIT 契約 5 本** ——
  `etzhayyim/root` に該当する WIT パッケージが 1 つも無い。
- `Kotodama component: wasm/etzhayyim-wasm-eigyo-e1gy0ai8` —— `e1gy0ai8` は
  `80-data/kosei/config.json` に **auto 割り当ての T1 tier 行として 1 回**出るだけで、
  ビルド済みコンポーネントは見つからない。
- `Sales cockpit: https://eigyo.etzhayyim.com/` —— DNS が解決しない。

加えて、この repo 自身が持つ 2 つの未解決点:

- **`NOTICE` が使用条件にしている `CHARTER-RIDER.md` がこの repo に無い。**
- **コードが書き込む 3 つの NSID に lexicon が無い。**
  `etzhayyim/root` の `00-contracts/lexicons/com/etzhayyim/apps/` にあるのは
  `etzhayyim` / `hakken` / `kotoba` / `maps3d` / `murakumoFleet` で、`eigyo` は無い。
- `README.edn` は自身を `com-etzhayyim-app-eigyo` と名乗る。この名前は
  GitHub のリダイレクトで今も `cloud-itonami/eigyo` に解決するが、現在名ではない。

これらは「直した」のではなく「見つけて記録した」段階である。
`MIGRATION-TODO.md` のチェックリストは未着手のまま残っている。

## ライセンス

Apache License 2.0 + etzhayyim Charter Compliance Rider v3.1（`NOTICE` 参照。
ただし上記のとおり rider 本文はこの repo に無い）。
