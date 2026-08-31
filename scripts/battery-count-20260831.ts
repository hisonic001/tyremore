/**
 * ⭐ 배터리 실사 — 사장님 재고표 그대로 수량 맞추기 (2026-08-31)
 *
 *   근거: 바탕화면 `배터리_재고표.xlsx` (기준일 2026-08-31 · 31종목 108개, 사장님 작성).
 *   조정은 화면 실사와 같은 길(`setDotQty`)로 간다 — stock_movement 에 「조정」 흔적이 남아
 *   나중에 왜 바뀌었는지 알 수 있다. 배터리 재고 행은 전부 DOT 없음(실측 28행) → dot:null.
 *
 *   표에서 그대로 옮기며 정리한 것:
 *   · 표 18·19행 「HK MF54459」와 「HK 44DL」은 **같은 모델의 두 이름** (사장님 확인
 *     "MF54459=HK44DL") → 한 상품에 합해 2개. 제조사 요약 「한국 87개」와 정확히 맞는다.
 *   · 「HK MF55054」 = HK50DL 의 DIN 코드 (550 54 = 50AH) → 숨겨 뒀던 HK50DL 을
 *     다시 켜고 이름 바꿔서 1개.
 *   · 델코 AGM **LN5 R · LN6 R 을 따로 센다** — 어제 「같은 모델 두 벌」로 합쳤는데
 *     사장님 표가 별개 종목으로 센다 → 상품을 다시 만들어 가른다 (4→3+1, 2→1+1).
 *   · 「바르타 AGM AUX14」 — 앱에 없던 브랜드. 새로 만든다 (보조배터리).
 *   · 표에 없는 델코 DIN50L·로케트 DIN54459 는 0으로.
 *
 *   실행: npx tsx --env-file=.env.local scripts/battery-count-20260831.ts          (보기만)
 *         npx tsx --env-file=.env.local scripts/battery-count-20260831.ts --apply  (실행)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { setDotQty } from "@/lib/stock";

const APPLY = process.argv.includes("--apply");
const REASON = "실사 — 배터리 재고표 2026-08-31";

/** 기존 상품 id → 표 수량 */
const TARGETS: [number, number, string][] = [
  [44751, 16, "한국 HK MF90L 90AH"],
  [44749, 15, "한국 HK MF80L 80AH"],
  [44752, 15, "한국 HK MF90R 90AH"],
  [46018, 10, "한국 HK MF58043 80AH"],
  [44753, 8, "한국 HK MF100L 100AH"],
  [44754, 4, "한국 HK MF100R 100AH"],
  [44745, 1, "한국 HK MF40FL 40AH"],
  [44765, 2, "한국 HK MF56219 62AH"],
  [44746, 2, "한국 HK MF50L 50AH"],
  [44756, 2, "한국 HK MF120L 120AH"],
  [44758, 2, "한국 HK MF150L 150AH"],
  [44759, 2, "한국 HK MF170L 170AH"],
  [44761, 2, "한국 HK MF200L 200AH"],
  [44750, 1, "한국 HK MF80R 80AH"],
  [46019, 1, "한국 HK MF60038 100AH"],
  [44747, 1, "한국 HK MF60L 60AH"],
  [44763, 1, "한국 HK MF55054 50AH"], // ← HK50DL 되살려 이름 바꾼 것
  [44762, 2, "한국 HK MF54459 44AH"], // ← 표 18·19행 합 (같은 모델 두 이름)
  [6398, 4, "델코 AGM LN3 70AH"],
  [6401, 3, "델코 AGM LN5 95AH"],
  [6399, 3, "델코 AGM LN4 80AH"],
  [6397, 2, "델코 AGM LN2 60AH"],
  [6403, 1, "델코 AGM LN6 105AH"],
  [6430, 1, "델코 DIN74R 74AH"],
  [44740, 2, "로케트 AGM RAGM80 80AH"],
  [46017, 1, "로케트 GB55065 50AH"],
  [44741, 1, "로케트 AGM RAGM95 95AH"],
  // 표에 없는 것 — 0 으로
  [6425, 0, "델코 DIN50L 50AH"],
  [44720, 0, "로케트 DIN54459 44AH"],
];

/** 새로 만들 상품 (없으면 만들고, 있으면 그대로) → 표 수량 */
const NEW_PRODUCTS: { name: string; brand: string | null; qty: number }[] = [
  { name: "델코 AGM LN5 R 95AH", brand: "DELKOR", qty: 1 },
  { name: "델코 AGM LN6 R 105AH", brand: "DELKOR", qty: 1 },
  { name: "바르타 AGM AUX14", brand: null, qty: 1 },
];

const cur = async (id: number) =>
  Number(
    (
      await db.execute<{ s: string }>(
        sql`SELECT COALESCE(SUM(qty),0) s FROM stock_item WHERE product_id = ${id} AND status = '재고'`,
      )
    )[0].s,
  );

async function main() {
  console.log(APPLY ? "🔴 실행 모드 (--apply)\n" : "👀 보기만 합니다 (--apply 로 실행)\n");

  /* ── 준비 ①: HK50DL 되살려 MF55054 로 ── */
  const [hk50] = await db.execute<{ name: string; act: boolean }>(
    sql`SELECT COALESCE(display_name, name_auto, raw_name) name, is_active act FROM product WHERE id = 44763`,
  );
  if (hk50 && (!hk50.act || hk50.name !== "한국 HK MF55054 50AH")) {
    console.log(`준비 · #44763 「${hk50.name}」 → 다시 켜고 「한국 HK MF55054 50AH」 (표의 MF55054 = HK50DL)`);
    if (APPLY)
      await db.execute(
        sql`UPDATE product SET is_active = true, display_name = '한국 HK MF55054 50AH' WHERE id = 44763`,
      );
  }

  /* ── 준비 ②: 새 상품 ── */
  const newIds = new Map<string, number>();
  for (const n of NEW_PRODUCTS) {
    const [ex] = await db.execute<{ id: number }>(
      sql`SELECT id FROM product WHERE COALESCE(display_name, name_auto, raw_name) = ${n.name} LIMIT 1`,
    );
    if (ex) {
      newIds.set(n.name, Number(ex.id));
      continue;
    }
    console.log(`준비 · 새 상품 「${n.name}」 만들기`);
    if (APPLY) {
      const [made] = await db.execute<{ id: number }>(sql`
        INSERT INTO product (raw_name, display_name, brand_code, item_type, is_serialized, is_active)
        VALUES (${n.name}, ${n.name}, ${n.brand}, 'part', false, true)
        RETURNING id
      `);
      newIds.set(n.name, Number(made.id));
    }
  }

  /* ── 수량 맞추기 ── */
  console.log("\n수량 조정 (앱 → 표)");
  const jobs: [number, number, string][] = [
    ...TARGETS,
    ...NEW_PRODUCTS.filter((n) => newIds.has(n.name)).map(
      (n) => [newIds.get(n.name)!, n.qty, n.name] as [number, number, string],
    ),
  ];
  let changed = 0;
  for (const [id, want, label] of jobs) {
    const now = await cur(id);
    if (now === want) continue;
    console.log(`  · ${label}  ${now} → ${want}`);
    changed++;
    if (APPLY) {
      const r = await setDotQty({ productId: id, dot: null, qty: want, reason: REASON });
      if (!r.ok) console.log(`    ⚠️ 실패: ${r.error}`);
    }
  }
  if (changed === 0) console.log("  (표와 전부 같습니다 — 바꿀 것 없음)");

  /* ── 검산: 배터리 총량 = 표의 108 ── */
  const [tot] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(s.qty),0) s FROM stock_item s JOIN product p ON p.id = s.product_id
    WHERE s.status = '재고' AND p.item_type = 'part'
      AND COALESCE(p.display_name, p.name_auto, p.raw_name) ~ '^(한국 HK|델코 |로케트 |바르타 )'
  `);
  console.log(`\n배터리 총량: ${tot.s}개 (표의 합계 108개${Number(tot.s) === 108 ? " ✓ 일치" : APPLY ? " 🔴 불일치!" : " — 실행하면 108이 되어야 함"})`);
  if (APPLY && Number(tot.s) !== 108) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 500));
