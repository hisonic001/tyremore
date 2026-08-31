/**
 * ⭐ 배터리 품목 정리 (사장님 요청 2026-08-31)
 *
 *   "내가 원하는 건 한국 HK MF80L 80AH … 이렇게 간단하게 원하는 거지
 *    무슨 혼용 모델까지 전부 나오게 하려는 것이 아님."
 *
 *   ① 같은 물건 두 벌 합치기 (HK80DL=MF58043 은 사장님 확인)
 *   ② 취급 모델 이름을 「브랜드 + 모델코드 + 용량AH」로 (display_name — raw_name 은 D-08 보존)
 *   ③ 재고·판매·매입이 없고 매입명세(싸군배터리 6~8월)에도 없는 카탈로그 모델 숨기기
 *
 *   근거 자료: 통합자동화/배터리가격.png (도매표 2025-06-14) + 바탕화면 claude/배터리매입/ 4장.
 *   DIN 코드 = 가운데 두 자리가 용량 (54459=44AH · 56219=62 · 57412=74 · 58043=80 · 60038=100).
 *
 *   실행: npx tsx --env-file=.env.local scripts/battery-cleanup-20260831.ts          (보기만)
 *         npx tsx --env-file=.env.local scripts/battery-cleanup-20260831.ts --apply  (실행)
 *   숨김 되돌리기(SQL 한 줄): UPDATE product SET is_active = true WHERE id IN (…아래 출력 목록…);
 */
/* db 가 import 시점에 DATABASE_URL 을 요구한다 — 반드시 --env-file 로 실행:
 *   npx tsx --env-file=.env.local scripts/battery-cleanup-20260831.ts [--apply] */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { mergeProducts } from "@/lib/product-merge";

const APPLY = process.argv.includes("--apply");

/** ① 합치기 — 남길 것과 새 이름, 흡수할 것 */
const MERGES: { keep: number; absorb: number[]; name: string; why: string }[] = [
  { keep: 46018, absorb: [44768], name: "한국 HK MF58043 80AH", why: "사장님 확인 — HK80DL 과 같은 것" },
  { keep: 46019, absorb: [44771], name: "한국 HK MF60038 100AH", why: "60038=100AH DIN = HK100DL" },
  { keep: 6399, absorb: [6400], name: "델코 AGM LN4 80AH", why: "도매표의 델코 AGM LN4 — 한 모델 두 벌" },
  { keep: 6401, absorb: [6402], name: "델코 AGM LN5 95AH", why: "델코 AGM LN5 — 한 모델 두 벌" },
  { keep: 6403, absorb: [45582], name: "델코 AGM LN6 105AH", why: "사장님이 원하신 「델코 AGM LN6 105AH」" },
];

/** ② 이름 — 취급 모델만. 코드를 모르는 DIN(HK50DL 등)은 어차피 ③에서 숨는다 */
const RENAMES: [number, string][] = [
  [44745, "한국 HK MF40FL 40AH"],
  [44746, "한국 HK MF50L 50AH"],
  [44747, "한국 HK MF60L 60AH"],
  [44749, "한국 HK MF80L 80AH"],
  [44750, "한국 HK MF80R 80AH"],
  [44751, "한국 HK MF90L 90AH"],
  [44752, "한국 HK MF90R 90AH"],
  [44753, "한국 HK MF100L 100AH"],
  [44754, "한국 HK MF100R 100AH"],
  [44756, "한국 HK MF120L 120AH"],
  [44758, "한국 HK MF150L 150AH"],
  [44759, "한국 HK MF170L 170AH"],
  [44761, "한국 HK MF200L 200AH"],
  [44762, "한국 HK MF54459 44AH"], // HK44DL (사장님 확인)
  [44765, "한국 HK MF56219 62AH"], // HK62DL — 코드가 이름에 이미 있었다
  [44766, "한국 HK MF57412 74AH"], // HK74DL — 매입명세 7~8월 14개, 앱 기록만 없다
  [6397, "델코 AGM LN2 60AH"],
  [6398, "델코 AGM LN3 70AH"],
  [6425, "델코 DIN50L 50AH"],
  [6430, "델코 DIN74R 74AH"],
  [6392, "델코 DF170L 170AH"],
  [6421, "델코 DF90R 90AH"],
  [6390, "델코 DF65-900 65AH"],
  [44740, "로케트 AGM RAGM80 80AH"],
  [44741, "로케트 AGM RAGM95 95AH"],
  [44720, "로케트 DIN54459 44AH"],
  [46017, "로케트 GB55065 50AH"],
];

/** ③에서 절대 숨기지 않는 것 — 취급 모델 (이름을 바꾸는 것 + 합침 대표 + 로케트 65-114) */
const KEEP = new Set<number>([...RENAMES.map(([id]) => id), ...MERGES.map((m) => m.keep), 44736]);

async function main() {
  console.log(APPLY ? "🔴 실행 모드 (--apply)\n" : "👀 보기만 합니다 (--apply 로 실행)\n");

  /* 재고 합 — 합치기 전후로 변하면 안 된다 */
  const stockSum = async () =>
    Number(
      (
        await db.execute<{ s: string }>(
          sql`SELECT COALESCE(SUM(qty),0) s FROM stock_item WHERE status = '재고' AND product_id IN
              (SELECT id FROM product WHERE item_type = 'part')`,
        )
      )[0].s,
    );
  const before = await stockSum();

  /* ── ① 합치기 ── */
  console.log("① 같은 물건 합치기");
  for (const m of MERGES) {
    const rows = await db.execute<{ id: number; name: string; brand: string | null }>(sql`
      SELECT id, COALESCE(display_name, name_auto, raw_name) name, brand_code brand
      FROM product WHERE id IN (${sql.join([m.keep, ...m.absorb].map((i) => sql`${i}`), sql`, `)})
    `);
    const keep = rows.find((r) => Number(r.id) === m.keep);
    const gone = rows.filter((r) => Number(r.id) !== m.keep);
    if (!keep || gone.length === 0) {
      console.log(`  · ${m.name} — 이미 합쳐져 있습니다 (건너뜀)`);
      continue;
    }
    console.log(`  · ${gone.map((g) => g.name).join(" + ")} → 「${m.name}」 (${m.why})`);
    if (APPLY) {
      // 브랜드가 비어 있으면 대표 쪽에 맞춘다 — mergeProducts 가 브랜드 다른 합침을 막는다
      for (const g of [...gone, keep]) {
        if (g.brand === null && keep.brand !== null) {
          await db.execute(sql`UPDATE product SET brand_code = ${keep.brand} WHERE id = ${Number(g.id)}`);
        }
      }
      if (keep.brand === null && gone.some((g) => g.brand !== null)) {
        const b = gone.find((g) => g.brand !== null)!.brand;
        await db.execute(sql`UPDATE product SET brand_code = ${b} WHERE id = ${m.keep}`);
      }
      const r = await mergeProducts(m.keep, m.absorb);
      if (!r.ok) {
        console.log(`    ⚠️ 합치기 실패: ${r.error}`);
        continue;
      }
      console.log(`    ✅ ${r.moved}`);
    }
  }

  /* ── ② 이름 바꾸기 (합침 대표 포함) ── */
  console.log("\n② 이름 바꾸기 — 「브랜드 + 모델코드 + 용량AH」");
  const all: [number, string][] = [...RENAMES, ...MERGES.map((m) => [m.keep, m.name] as [number, string])];
  for (const [id, name] of all) {
    const [p] = await db.execute<{ name: string }>(
      sql`SELECT COALESCE(display_name, name_auto, raw_name) name FROM product WHERE id = ${id}`,
    );
    if (!p) {
      console.log(`  ⚠️ #${id} 없음 — 건너뜀`);
      continue;
    }
    if (p.name === name) continue; // 이미 됐다 (되풀이 실행 안전)
    console.log(`  · ${p.name}  →  ${name}`);
    if (APPLY) await db.execute(sql`UPDATE product SET display_name = ${name} WHERE id = ${id}`);
  }

  /* ── ③ 숨기기 — 배터리 이름꼴 + 앱 기록 0 + 취급 목록에 없음 ── */
  console.log("\n③ 카탈로그만 있고 안 쓰는 모델 숨기기");
  const hide = await db.execute<{ id: number; name: string }>(sql`
    SELECT p.id, COALESCE(p.display_name, p.name_auto, p.raw_name) name
    FROM product p
    WHERE p.item_type = 'part' AND p.is_active
      AND COALESCE(p.display_name, p.name_auto, p.raw_name)
          ~ '^(한국 (HK|BX|AX|TX|AGM|100L|MF)|한국MF|델코 |DELKOR|로케트 |아트라스)'
      AND NOT EXISTS (SELECT 1 FROM stock_item s WHERE s.product_id = p.id AND s.status = '재고' AND s.qty > 0)
      AND NOT EXISTS (SELECT 1 FROM quote_item qi WHERE qi.product_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM purchase_invoice_item ii WHERE ii.product_id = p.id)
      AND p.id NOT IN (${sql.join([...KEEP].map((i) => sql`${i}`), sql`, `)})
    ORDER BY name
  `);
  for (const h of hide) console.log(`  · #${h.id}  ${h.name}`);
  console.log(`  = ${hide.length}개`);
  if (APPLY && hide.length > 0) {
    await db.execute(sql`
      UPDATE product SET is_active = false
      WHERE id IN (${sql.join(hide.map((h) => sql`${Number(h.id)}`), sql`, `)})
    `);
    console.log(`  ✅ ${hide.length}개 숨김 (지운 게 아니다 — 위 id 로 되돌릴 수 있다)`);
  }

  const after = await stockSum();
  console.log(`\n재고 합 (부품): ${before} → ${after} ${before === after ? "✓ 그대로" : "🔴 달라짐!"}`);
  if (APPLY && before !== after) process.exitCode = 1;

  console.log("\n📝 참고: 8/28 매입명세의 GM54018 은 앱에 상품이 없다 — 필요하면 화면에서 새로 등록.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 500));
