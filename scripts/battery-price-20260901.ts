/**
 * ⭐ 배터리 매입 원가 반영 — 2026-09-01 싸군배터리 인상 단가표 (사장님 요청 2026-09-12)
 *
 *   표는 `src/lib/battery-price-list.ts` 한 곳(화면도 같은 표를 본다).
 *   여기서는 그 값을 `product.purchase_price` 에 넣기만 한다.
 *
 *   · 짝: `category='배터리' AND part_no = 품명` → 안 되면 상수표의 `productId`
 *   · price=null(사진에서 안 읽힌 4종)은 **건너뛴다**
 *   · 짝이 없으면 **만들지 않고 보고만** 한다 (품목 신설은 사람이 판단)
 *   · `is_active`·`fitment`·이름은 손대지 않는다 (검색·이름 규칙이 걸려 있다)
 *   · 이미 판 줄의 `quote_item.purchase_cost` 는 고치지 않는다 —
 *     인상 전 가격으로 사 둔 재고를 판 것이라 그때 원가가 사실이다.
 *
 *   실행:
 *     npx tsx --env-file=.env.local scripts/battery-price-20260901.ts --dry   ← 집계만
 *     npx tsx --env-file=.env.local scripts/battery-price-20260901.ts        ← 실적용 + docs 기록
 *   다시 돌려도 안전(멱등).
 */
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
import postgres from "postgres";
import { BATTERY_PRICES, PRICE_HISTORY_KEY, PRICE_LIST_DATE, PRICE_LIST_SOURCE } from "../src/lib/battery-price-list";

config({ path: ".env.local" });

const DRY = process.argv.includes("--dry");
const DOC_PATH = `docs/배터리단가-${PRICE_LIST_DATE.replace(/-/g, "")}.md`;

type Row = { id: number; part_no: string | null; name: string; purchase_price: number | null; is_active: boolean };

function won(n: number | null): string {
  return n === null ? "—" : n.toLocaleString();
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const rows = await sql<Row[]>`
      SELECT p.id, p.part_no, COALESCE(NULLIF(p.display_name, ''), p.raw_name) name,
             p.purchase_price, p.is_active
      FROM product p
      WHERE p.category = '배터리'
    `;
    const byPartNo = new Map<string, Row>();
    const byId = new Map<number, Row>();
    for (const r of rows) {
      byId.set(Number(r.id), r);
      if (r.part_no) byPartNo.set(r.part_no, r);
    }

    const up: string[] = [];
    const down: string[] = [];
    const same: string[] = [];
    const filled: string[] = [];
    const missing: string[] = [];
    const skipped: string[] = [];
    const matchedIds = new Set<number>();
    const plan: { id: number; price: number }[] = [];

    for (const t of BATTERY_PRICES) {
      const hit = t.productId ? byId.get(t.productId) : byPartNo.get(t.name);
      if (!hit) {
        missing.push(`${t.brand} ${t.name} (${t.series}) — 표 ${won(t.price)}`);
        continue;
      }
      matchedIds.add(Number(hit.id));
      if (t.price === null) {
        skipped.push(`${t.brand} ${t.name} — 사진에서 안 읽힘, 지금 값 ${won(hit.purchase_price)} 그대로`);
        continue;
      }
      const old = hit.purchase_price === null ? null : Number(hit.purchase_price);
      const line = `${t.brand} ${t.name}${hit.is_active ? "" : " (안 받는 것)"}  ${won(old)} → ${won(t.price)}`;
      if (old === null) filled.push(line);
      else if (t.price > old) up.push(`${line}  (+${(t.price - old).toLocaleString()} · +${((t.price / old - 1) * 100).toFixed(1)}%)`);
      else if (t.price < old) down.push(`${line}  (${(t.price - old).toLocaleString()})`);
      else {
        same.push(line);
        continue; // 같은 값은 UPDATE 도 안 한다
      }
      plan.push({ id: Number(hit.id), price: t.price });
    }

    /** 앱에는 있는데 이번 표에 없는 배터리 — 값이 그대로 남는다 */
    const others = rows
      .filter((r) => !matchedIds.has(Number(r.id)))
      .map((r) => `${r.name}${r.part_no ? ` [${r.part_no}]` : ""} — ${won(r.purchase_price === null ? null : Number(r.purchase_price))}${r.is_active ? "" : " (안 받는 것)"}`);
    const othersActive = rows.filter((r) => !matchedIds.has(Number(r.id)) && r.is_active);

    const avg =
      up.length + down.length > 0
        ? BATTERY_PRICES.filter((t) => t.price !== null).reduce((acc, t) => {
            const hit = t.productId ? byId.get(t.productId) : byPartNo.get(t.name);
            const old = hit?.purchase_price == null ? null : Number(hit.purchase_price);
            return old ? acc + (t.price! / old - 1) : acc;
          }, 0)
        : 0;
    const avgPct = (avg / (up.length + down.length + same.length)) * 100;

    console.log(`\n📋 ${PRICE_LIST_DATE} ${PRICE_LIST_SOURCE} 단가표 — 표 ${BATTERY_PRICES.length}종 · 앱 배터리 ${rows.length}종`);
    console.log(`   짝 맞음 ${matchedIds.size} · 짝 없음 ${missing.length}`);
    console.log(`   올라감 ${up.length} · 내려감 ${down.length} · 그대로 ${same.length} · 새로 채움 ${filled.length} · 건너뜀 ${skipped.length}`);
    console.log(`   평균 ${avgPct >= 0 ? "+" : ""}${avgPct.toFixed(1)}%\n`);

    if (down.length) console.log("↓ 내려간 것\n  " + down.join("\n  ") + "\n");
    if (filled.length) console.log("＋ 원가가 비어 있던 것 (이번에 채움)\n  " + filled.join("\n  ") + "\n");
    if (skipped.length) console.log("? 사진에서 안 읽혀 건너뜀\n  " + skipped.join("\n  ") + "\n");
    if (missing.length) console.log("⚠️ 표에 있는데 앱에 짝 없음 — 손이 필요합니다\n  " + missing.join("\n  ") + "\n");
    if (othersActive.length)
      console.log(
        "ℹ️ 앱에 있는데 이번 표에 없음 (값 그대로 둠, 취급 중인 것만)\n  " +
          othersActive.map((r) => `${r.name}${r.part_no ? ` [${r.part_no}]` : ""} — ${won(r.purchase_price === null ? null : Number(r.purchase_price))}`).join("\n  ") +
          "\n",
      );

    if (DRY) {
      console.log(`🔎 --dry — 쓰지 않았습니다. ${plan.length}종이 바뀔 예정입니다.`);
      return;
    }

    const diff: { partNo: string; productId: number; from: number | null; to: number }[] = [];
    for (const p of plan) {
      const before = byId.get(p.id)?.purchase_price;
      await sql`UPDATE product SET purchase_price = ${p.price}, updated_at = now() WHERE id = ${p.id}`;
      diff.push({
        partNo: byId.get(p.id)?.part_no ?? String(p.id),
        productId: p.id,
        from: before === null || before === undefined ? null : Number(before),
        to: p.price,
      });
    }
    console.log(`✅ ${plan.length}종 원가 갱신 완료`);

    /**
     * 이력 — 새 표를 만들지 않고 app_setting 한 행에 남긴다(선례 invoice_deadline_skip).
     * 화면이 이걸 읽어 「전 78,900」을 회색으로 보여 준다.
     */
    const setting = JSON.stringify({ appliedAt: new Date().toISOString(), listDate: PRICE_LIST_DATE, rows: diff });
    await sql`
      INSERT INTO app_setting (key, value, updated_at) VALUES (${PRICE_HISTORY_KEY}, ${setting}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `;
    console.log(`🗂  app_setting '${PRICE_HISTORY_KEY}' 에 ${diff.length}줄 기록`);

    const doc = [
      `# 배터리 매입 원가 — ${PRICE_LIST_DATE} ${PRICE_LIST_SOURCE} (VAT 별도)`,
      "",
      `적용 ${new Date().toISOString().slice(0, 10)} · 표 ${BATTERY_PRICES.length}종 · 바뀐 것 ${plan.length}종 · 평균 ${avgPct >= 0 ? "+" : ""}${avgPct.toFixed(1)}%`,
      "",
      `## 올라감 (${up.length})`,
      ...up.map((s) => `- ${s}`),
      "",
      `## 내려감 (${down.length})`,
      ...down.map((s) => `- ${s}`),
      "",
      `## 원가가 비어 있던 것 — 이번에 채움 (${filled.length})`,
      ...filled.map((s) => `- ${s}`),
      "",
      `## 그대로 (${same.length})`,
      ...same.map((s) => `- ${s}`),
      "",
      `## 사진에서 안 읽혀 건너뜀 (${skipped.length})`,
      ...skipped.map((s) => `- ${s}`),
      "",
      `## 표에 있는데 앱에 짝 없음 (${missing.length})`,
      ...missing.map((s) => `- ${s}`),
      "",
      `## 앱에 있는데 표에 없음 (${others.length}) — 값 그대로`,
      ...others.map((s) => `- ${s}`),
      "",
    ].join("\n");
    writeFileSync(DOC_PATH, doc, "utf8");
    console.log(`📄 ${DOC_PATH} 기록`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
