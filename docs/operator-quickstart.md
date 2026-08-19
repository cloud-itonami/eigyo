# operator quickstart — eigyo

**この文書の約束**: ここに載っている手順は全部、書いたあとで
**clean な checkout に対して逐語で踏み直してある**。踏めなかった手順は
載せていない。落ちる手順は「落ちる」と書いてあり、その落ち方まで載せている
（落ちること自体が、この repo についての事実だから）。

実測日 2026-08-19 / 対象 commit `5038d10` /
macOS 26.3.1 arm64・node v26.3.0・npm 11.16.0・pnpm 10.26.2。

所要 10 分。**step 4 がこの repo で唯一「実際に動く」経路**なので、
時間が無ければ step 1 → 4 だけでよい。

---

## step 1 — tree を取る

```bash
git clone git@github.com:cloud-itonami/eigyo.git /tmp/eigyo-walk
cd /tmp/eigyo-walk
git log -1 --format='%h %cI'
git ls-files
```

期待:

```
5038d10 2026-07-20T00:24:43+09:00
MIGRATION-TODO.md
NOTICE
PROJECT.jsonld
README.edn
README.md
kotoba/package.json
kotoba/src/deal.ts
kotoba/src/index.ts
kotoba/src/lead.ts
kotoba/src/settlement.ts
kotoba/src/tithe.ts
kotoba/src/types.ts
kotoba/test/eigyo.test.ts
kotoba/tsconfig.json
kotoba/vitest.config.ts
migration.edn
```

16 ファイル。これが全部で、ビルド成果物も `node_modules` も lockfile も無い。

---

## step 2 — `pnpm install` は通らない（2 段で落ちる）

`kotoba/package.json` が宣言する唯一の実行手順は `pnpm test` だが、
その前段の install が通らない。**これは環境の問題ではなく、この repo の
依存の張り方の問題**なので、そのまま再現する。

```bash
cd /tmp/eigyo-walk/kotoba
pnpm install
```

**1 段目** — pnpm 10 は、build script を持つ git 依存を既定で拒否する:

```
 ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED  Failed to prepare git-hosted package fetched from
 "git@github.com:etzhayyim/com-etzhayyim-sdk.git": The git-hosted package
 "@etzhayyim/sdk@0.1.0-alpha" needs to execute build scripts but is not in the
 "onlyBuiltDependencies" allowlist.
```

`@etzhayyim/sdk` は `main: ./dist/index.js` を指しており、`prepare: tsc` で
`dist/` を作る。だから pnpm は「build script を走らせる許可」を要求する。
言われたとおり許可すると:

```bash
printf 'onlyBuiltDependencies:\n  - "@etzhayyim/sdk"\n' > pnpm-workspace.yaml
pnpm install
```

**2 段目** — 今度は pnpm が内部で呼ぶ `npm install` 自身が拒否する:

```
npm error code EALLOWSCRIPTS
npm error --allow-scripts is not allowed in project-scoped installs.
          Add the entries to the "allowScripts" field in package.json, or to .npmrc, instead.
 ERR_PNPM_PREPARE_PACKAGE  Failed to prepare git-hosted package fetched from
 "git@github.com:etzhayyim/com-etzhayyim-sdk.git": @etzhayyim/sdk@0.1.0-alpha npm-install: `npm install`
```

pnpm 10.26 の git 依存 prepare が npm に `--allow-scripts` を渡すのに対し、
npm 11.16 は project-scoped install でそれを受け付けない。

**結果**: `node_modules` は 1 件もできない。したがって

- `pnpm test`（`vitest run`）は**走らない** —— `test/eigyo.test.ts` は
  `@etzhayyim/sdk-mock` を実行時に import する
- `pnpm typecheck` も通らない（step 3）

作った `pnpm-workspace.yaml` は捨てる:

```bash
rm -f /tmp/eigyo-walk/kotoba/pnpm-workspace.yaml
```

> ⚠ ここで「テストが赤い」のではない。**一度も走っていない。**
> 緑と区別できない沈黙なので、この repo のテストスイートを
> 「通っている」根拠に使わないこと。

---

## step 3 — typecheck も通らない（何が足りないかは分かる）

```bash
cd /tmp/eigyo-walk/kotoba
npx --yes -p typescript@5.6 tsc --noEmit
```

期待（7 error）:

```
src/deal.ts(10,32): error TS2307: Cannot find module '@etzhayyim/sdk' or its corresponding type declarations.
src/deal.ts(108,14): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/deal.ts(114,11): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/lead.ts(6,32): error TS2307: Cannot find module '@etzhayyim/sdk' or its corresponding type declarations.
src/lead.ts(84,14): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/lead.ts(90,11): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/settlement.ts(8,43): error TS2307: Cannot find module '@etzhayyim/sdk' or its corresponding type declarations.
```

7 件のうち独立した原因は **TS2307 が 3 件**だけ（`@etzhayyim/sdk` が無い）。
残る TS7006 4 件はその派生 —— `Etzhayyim` が `any` に落ちるので
`resp.records` の要素型が消え、`.filter((r) => …)` の `r` が暗黙 any になる。
**SDK の型さえ入れば 7 件とも消える。この repo 自身の型エラーではない。**

---

## step 4 — ドメインロジックを install 無しで実際に動かす ★

ここがこの repo で唯一「動く」経路。**npm install は要らない。**

理由は README の依存表のとおり —— `lead.ts` と `deal.ts` は
`import type { Etzhayyim }` しか使っておらず、型は実行時に消える。
必要なのは `read` / `write` の 2 メソッドを持つ値だけである。

`kotoba/` の中に scratch ファイルを 1 枚作る（`kotoba/package.json` の
`"type": "module"` が要るので、置き場所はここでなければならない）:

```bash
cd /tmp/eigyo-walk/kotoba
cat > walk.local.ts <<'EOF'
// lead.ts / deal.ts が使う Etzhayyim seam の、インメモリの代役。
// この repo が実際に呼ぶのは read() と write() の 2 つだけ。
const store = new Map<string, any>();
const e: any = {
  async read({ collection, rkey }: any) {
    if (rkey) {
      const v = store.get(`${collection}/${rkey}`);
      return v ? { records: [{ uri: `at://local/${collection}/${rkey}`, value: v }] } : { records: [] };
    }
    return {
      records: [...store.entries()]
        .filter(([k]) => k.startsWith(`${collection}/`))
        .map(([k, v]) => ({ uri: `at://local/${k}`, value: v })),
    };
  },
  async write({ collection, record, rkey }: any) {
    store.set(`${collection}/${rkey}`, record);
    return { uri: `at://local/${collection}/${rkey}` };
  },
};

import { createLead, getLead, listLeads } from "./src/lead.js";
import { createDeal, getDeal, listDeals, advanceDeal, settleDeal } from "./src/deal.js";
import { splitTithe, parseMicros } from "./src/tithe.js";

const settle = async () => ({ txHash: "0xwon" });
const PAYOUT = "0x9999999999999999999999999999999999999999";
const owner = "did:web:rep.etzhayyim.com";

const s = splitTithe(parseMicros("100000000"));
console.log("1  tithe        ", `gross=${s.gross} tithe=${s.tithe} net=${s.net} leak=${s.gross - s.tithe - s.net}`);

console.log("2  createLead   ", (await createLead(e, { leadId: "LD-1", ownerDid: owner, company: "Acme Inc", source: "web" })).status);
console.log("3  getLead      ", (await getLead(e, { leadId: "LD-1" })).lead?.status);
console.log("4  createLead#2 ", (await createLead(e, { leadId: "LD-1", ownerDid: owner, company: "Acme Inc" })).status);
console.log("5  no company   ", (await createLead(e, { leadId: "LD-2", ownerDid: owner, company: "" })).error);
console.log("6  listLeads    ", (await listLeads(e, { ownerDid: owner })).total);

const d = { dealId: "D-1", ownerDid: owner, title: "Acme annual license", valueMicros: "240000000" };
console.log("7  createDeal   ", (await createDeal(e, d)).status, (await getDeal(e, { dealId: "D-1" })).deal?.stage);
console.log("8  advance      ", (await advanceDeal(e, { dealId: "D-1", stage: "proposal" })).status);
console.log("9  bad stage    ", (await advanceDeal(e, { dealId: "D-1", stage: "voodoo" as any })).error);
console.log("10 settle notWon", (await settleDeal(e, settle, { dealId: "D-1", to: PAYOUT })).status);
await advanceDeal(e, { dealId: "D-1", stage: "won" });
console.log("11 re-stage won ", (await advanceDeal(e, { dealId: "D-1", stage: "proposal" })).error);
const r = await settleDeal(e, settle, { dealId: "D-1", to: PAYOUT });
console.log("12 settle       ", r.status, `tithe=${r.titheMicros} net=${r.netMicros} tx=${r.txHash}`);
console.log("13 deal txHash  ", (await getDeal(e, { dealId: "D-1" })).deal?.txHash);
console.log("14 double-settle", (await settleDeal(e, settle, { dealId: "D-1", to: PAYOUT })).status);
await createDeal(e, { ...d, dealId: "D-2" });
await advanceDeal(e, { dealId: "D-2", stage: "negotiation" });
console.log("15 filter stage ", (await listDeals(e, { stage: "negotiation" })).total, "of", (await listDeals(e)).total);
EOF
npx --yes tsx walk.local.ts
```

期待（15 行、逐語）:

```
1  tithe         gross=100000000 tithe=10000000 net=90000000 leak=0
2  createLead    created
3  getLead       new
4  createLead#2  alreadyExists
5  no company    missingRequiredFields
6  listLeads     1
7  createDeal    created prospecting
8  advance       advanced
9  bad stage     invalidStage
10 settle notWon notWon
11 re-stage won  dealTerminal:won
12 settle        settled tithe=24000000 net=216000000 tx=0xwon
13 deal txHash   0xwon
14 double-settle alreadySettled
15 filter stage  1 of 2
```

この 15 行が、committed のテストスイートが主張していること（走らせられない
まま）とほぼ同じ範囲を、**実際に実行して**確かめている:
tithe の無漏れ・lead の冪等と必須項目・deal の作成と stage 遷移・不正 stage の
拒否・終端 deal の再遷移拒否・`won` 前の決済拒否・決済の分割・deal への txHash
刻印・二重決済の拒否・stage による絞り込み。

> `npx tsx` を使うのは、`deal.ts` が `./types.js` のように **`.js` 拡張子で
> `.ts` ファイルを参照している**から（`tsconfig` の `moduleResolution: bundler`）。
> 素の `node walk.local.ts` は node が type-stripping はできても
> `.js → .ts` の読み替えをしないので `ERR_MODULE_NOT_FOUND: src/types.js` で落ちる。
> 依存の無い `src/tithe.ts` だけなら素の node で動く。

---

## step 5 — 決済が executor に渡す額を自分の目で見る

README の「知っておくべき挙動 1」を確かめる。**渡るのは gross であって net ではない。**

```bash
cd /tmp/eigyo-walk/kotoba
cat > probe.local.ts <<'EOF'
const store = new Map<string, any>();
const e: any = {
  async read({ collection, rkey }: any) {
    if (rkey) { const v = store.get(`${collection}/${rkey}`); return v ? { records: [{ uri: `at://local/${collection}/${rkey}`, value: v }] } : { records: [] }; }
    return { records: [...store.entries()].filter(([k]) => k.startsWith(`${collection}/`)).map(([k, v]) => ({ uri: `at://local/${k}`, value: v })) };
  },
  async write({ collection, record, rkey }: any) { store.set(`${collection}/${rkey}`, record); return { uri: `at://local/${collection}/${rkey}` }; },
};
import { createDeal, advanceDeal, settleDeal } from "./src/deal.js";
import { splitTithe, parseMicros } from "./src/tithe.js";

let seen: any = null;
const spy = async (o: any) => { seen = o; return { txHash: "0xspy" }; };
await createDeal(e, { dealId: "D-9", ownerDid: "did:web:rep.etzhayyim.com", title: "t", valueMicros: "240000000" });
await advanceDeal(e, { dealId: "D-9", stage: "won" });
const r = await settleDeal(e, spy, { dealId: "D-9", to: "0x99" });
console.log("executor received amountMicros =", seen.amountMicros, " purpose =", seen.purpose);
console.log("payment record  tithe =", r.titheMicros, " net =", r.netMicros);
console.log("gross==amountMicros?", seen.amountMicros === 240000000n);
for (const v of ["1","9","10","999","1000","12345"]) {
  const s = splitTithe(parseMicros(v));
  console.log(`  gross=${String(v).padStart(6)}  tithe=${String(s.tithe).padStart(5)}  net=${String(s.net).padStart(6)}  leak=${s.gross - s.tithe - s.net}`);
}
try { parseMicros("-1"); } catch (err: any) { console.log("parseMicros('-1') ->", err.constructor.name); }
try { parseMicros("1.5"); } catch (err: any) { console.log("parseMicros('1.5') ->", err.constructor.name); }
EOF
npx --yes tsx probe.local.ts
```

期待:

```
executor received amountMicros = 240000000n  purpose = internal-purchase
payment record  tithe = 24000000  net = 216000000
gross==amountMicros? true
  gross=     1  tithe=    0  net=     1  leak=0
  gross=     9  tithe=    0  net=     9  leak=0
  gross=    10  tithe=    1  net=     9  leak=0
  gross=   999  tithe=   99  net=   900  leak=0
  gross=  1000  tithe=  100  net=   900  leak=0
  gross= 12345  tithe= 1234  net= 11111  leak=0
parseMicros('-1') -> TypeError
parseMicros('1.5') -> TypeError
```

読み方:

- **1 行目と 2 行目が食い違って見えるのが正しい。** executor は 240 USDC 全額を
  受け取り、10% の分割は payment レコードの中にだけ在る。実際の分割は
  `donate()` の先の TitheRouter が行う前提。
  ⚠ **TitheRouter を通らない executor を注入すると、payment レコードは
  「10% 分けた」と記録するのに、チェーン上では分かれない。**
  レコードは主張であって領収書ではない。
- tithe は切り捨てなので `gross < 10` では 0。どの値でも `leak=0`。

---

## step 6 — デプロイ先は生きていない

```bash
dig +short eigyo.etzhayyim.com
dig +short etzhayyim.com
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 12 https://eigyo.etzhayyim.com/ ; echo "(exit $?)"
```

期待:

```
                                    ← eigyo.etzhayyim.com は空（解決しない）
104.21.51.111                       ← etzhayyim.com。2 行の順序と値は毎回変わる
172.67.179.128
curl: (6) Could not resolve host: eigyo.etzhayyim.com
000
(exit 6)
```

**確かめるのは「1 つ目の `dig` が空であること」だけ。** `etzhayyim.com` の
A レコードは Cloudflare の anycast なので、2 行の**順序も値も実行ごとに変わる**
（実測でも 2 回の walk で順序が入れ替わった）。ここを逐語一致で判定しないこと。

親ドメイン `etzhayyim.com` は解決するが、**この app のホスト名は存在しない**。
`curl` は exit 6（could not resolve host）。
したがって `did:web:eigyo.etzhayyim.com`（`src/types.ts` の
`EIGYO_DID_PREFIX` が組み立てる DID）も**引けない**。

---

## step 7 — 片付け

```bash
rm -f /tmp/eigyo-walk/kotoba/walk.local.ts /tmp/eigyo-walk/kotoba/probe.local.ts
rm -f /tmp/eigyo-walk/kotoba/pnpm-workspace.yaml
cd /tmp/eigyo-walk && git status --porcelain    # 何も出ないこと
cd / && rm -rf /tmp/eigyo-walk
```

`*.local.ts` は scratch であって repo の一部ではない。

---

## 次に何をするか

この quickstart は**現状を確かめる**ためのもので、直してはいない。
実際に前へ進めたいなら、依存関係の順に:

1. **`@etzhayyim/sdk` を install 可能にする** —— これが `pnpm test` /
   `pnpm typecheck` / `settlement.ts` の 3 つ同時のブロッカー。
   `dist/` を publish 済みの成果物として配るか、`prepare` の要らない形
   （ソース直参照）に変えるか、どちらか。step 2 の 2 段目は pnpm と npm の
   バージョン組み合わせにも依存するので、**直したと言う前に step 2 を踏み直すこと。**
2. **`test/eigyo.test.ts` を走らせる。** 1 が済めば走るはず。走らせるまでは
   「通っている」と言わない。
3. `MIGRATION-TODO.md` のチェックリスト（TRANSFORM codemod）。
4. lexicon（`com.etzhayyim.apps.eigyo.*` の 3 つ）と `CHARTER-RIDER.md` の不在。

**1 と 2 を飛ばして 3 に行かないこと** —— 検査が動かないまま構造を変えると、
壊したことに気付けない。
