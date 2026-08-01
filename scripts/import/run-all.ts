/**
 * 1주차 데이터 이관 — docs/09 5장의 순서를 그대로 따른다.
 *
 *   npx tsx scripts/import/run-all.ts --dry-run   ← DB 없이 변환만 검증
 *   npx tsx scripts/import/run-all.ts             ← 실제 적재
 *
 * 여러 번 다시 돌릴 수 있다(멱등). 한 번에 완벽하게 되는 이관은 없다.
 */
import { config } from "dotenv";
import { BRANDS, VEHICLE_MAKERS, MAKER_ALIASES } from "./seed-data";
import {
  transformCustomers,
  transformParts,
  transformProducts,
  transformServices,
  transformTireStock,
  transformVehicles,
  type Issue,
} from "./transform";

config({ path: ".env.local" });

const DRY = process.argv.includes("--dry-run");
const DATA_DIR = process.env.IMPORT_DATA_DIR ?? "C:/dev/tyremore-data";

const allIssues: Issue[] = [];
function section(title: string) {
  console.log(`\n${"─".repeat(64)}\n${title}`);
}
function stat(label: string, value: string | number, note = "") {
  console.log(`   ${label.padEnd(24)} ${String(value).padStart(8)}  ${note}`);
}

async function main() {
  console.log(`\n타이어모어 1주차 데이터 이관 ${DRY ? "[검증 모드 — DB에 쓰지 않음]" : "[실제 적재]"}`);
  console.log(`원본 폴더: ${DATA_DIR}`);

  /* 1·2. 시드 ------------------------------------------------ */
  section("1·2. 시드 (brand · vehicle_maker)");
  stat("브랜드", BRANDS.length, "종");
  stat("차량 제조사", VEHICLE_MAKERS.length, "코드");
  stat("제조사 표기 매핑", Object.keys(MAKER_ALIASES).length, "종 → 통합");

  /* 3. service_item ------------------------------------------ */
  section("3. service_item — 서비스·공임");
  const svc = transformServices(DATA_DIR);
  allIssues.push(...svc.issues);
  stat("서비스", svc.rows.length, "건");
  stat("↳ 부대비용 자동체크", svc.rows.filter((s) => s.autoSuggest).length, "건 (장착·밸런스)");
  stat("↳ 2개당 청구", svc.rows.filter((s) => s.qtyRule === "per_2_units").length, "건 ⭐ 휠밸런스");
  stat("↳ 국산/수입 구분", svc.rows.filter((s) => s.forImported !== null).length, "건");
  stat("↳ 단가 비어 있음", svc.rows.filter((s) => s.price === null).length, "건 → 건별 입력");

  /* 4. product (타이어·경정비) -------------------------------- */
  section("4. product — 상품 마스터 (MARS)");
  const prod = transformProducts(DATA_DIR);
  allIssues.push(...prod.issues);
  const tires = prod.rows.filter((p) => p.itemType === "tire");
  stat("상품 전체", prod.rows.length, "건");
  stat("↳ 타이어", tires.length, "건");
  stat("↳ 그 외(배터리·오일 등)", prod.rows.length - tires.length, "건");
  const parsed = tires.filter((t) => t.specParsed).length;
  stat("규격 파싱 성공", `${parsed}`, `(${((parsed / tires.length) * 100).toFixed(1)}%)`);
  stat("↳ 실패", tires.length - parsed, "건 → import_issue");
  stat("기표가 보유", prod.rows.filter((p) => p.listPrice !== null && p.listPrice > 0).length, "건");

  /* 5. product (부품) ---------------------------------------- */
  section("5. product — 부품 (재고 엑셀에서 신규 생성)");
  const parts = transformParts(DATA_DIR);
  allIssues.push(...parts.issues);
  stat("부품 품목", parts.rows.length, "종 (합집합)");
  const byCat = new Map<string, number>();
  for (const p of parts.rows) byCat.set(p.category, (byCat.get(p.category) ?? 0) + 1);
  for (const [c, n] of [...byCat].sort((a, b) => b[1] - a[1])) stat(`  ↳ ${c}`, n, "종");
  stat("적용차종 보유", parts.rows.filter((p) => p.fitment).length, "종 ← 부품 검색의 전부");
  console.log("   ⚠️ 수량은 가져오지 않는다. 실물과 맞지 않는다 (D-12 5번) → 전부 「미확인」");

  /* 6. customer ---------------------------------------------- */
  section("6. customer — MARS 「연락처」 ⭐ 「고객」이 아니다");
  const cust = transformCustomers(DATA_DIR);
  allIssues.push(...cust.issues);
  stat("고객", cust.rows.length, "명");
  const withPhone = cust.rows.filter((c) => c.phone).length;
  stat("휴대폰 보유", withPhone, `(${((withPhone / cust.rows.length) * 100).toFixed(1)}%)`);
  stat("이름에 메모 있음", cust.rows.filter((c) => c.memo).length, "건 ← 원문 보존");
  stat("법인", cust.rows.filter((c) => c.type === "법인").length, "건");

  /* 7. vehicle ----------------------------------------------- */
  section("7. vehicle — 차량");
  const veh = transformVehicles(DATA_DIR);
  allIssues.push(...veh.issues);
  stat("차량", veh.rows.length, "대");
  stat("제조사 매핑 성공", veh.rows.filter((v) => v.makerCode).length, "대");
  stat("모델 보유", veh.rows.filter((v) => v.model).length, "대");
  stat("연식 보유", veh.rows.filter((v) => v.year).length, "대");
  stat("주행거리 보유", veh.rows.filter((v) => v.mileage).length, "대");

  // 고객↔차량 연결 검증
  const contactNos = new Set(cust.rows.map((c) => c.marsContactNo));
  const orphan = veh.rows.filter((v) => !v.marsContactNo || !contactNos.has(v.marsContactNo));
  stat("고객 연결 실패", orphan.length, orphan.length === 0 ? "✅" : "⚠️ 확인 필요");

  /* 8. stock_item (타이어) ----------------------------------- */
  section("8. stock_item — 미쉐린 타이어 재고");
  const stock = transformTireStock(DATA_DIR);
  allIssues.push(...stock.issues);
  stat("재고 본수", stock.rows.length, "본 (1본 1행)");
  const codes = new Set(stock.rows.map((s) => s.marsItemNo));
  stat("품목", codes.size, "종");
  stat("DOT 보유", stock.rows.filter((s) => s.dot).length, "본");

  // MARS 품번과 매칭되는가 — D-12에서 100% 였다
  const prodCodes = new Set(prod.rows.map((p) => p.marsItemNo));
  const unmatched = [...codes].filter((c) => !prodCodes.has(c));
  stat("MARS 품번 매칭", `${codes.size - unmatched.length}/${codes.size}`, unmatched.length === 0 ? "✅ 100%" : `⚠️ ${unmatched.join(", ")}`);

  // 노후화 (DOT 기준)
  const byYear = new Map<string, number>();
  for (const s of stock.rows) {
    const y = s.dot ? `20${s.dot.slice(2, 4)}` : "미상";
    byYear.set(y, (byYear.get(y) ?? 0) + 1);
  }
  for (const [y, n] of [...byYear].sort()) stat(`  ↳ ${y}년산`, n, "본");

  /* 10. import_issue ----------------------------------------- */
  section("10. import_issue — 사람이 봐야 하는 것");
  const byKind = new Map<string, number>();
  for (const i of allIssues) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
  for (const [k, n] of [...byKind].sort((a, b) => b[1] - a[1])) stat(k, n, "건");
  stat("합계", allIssues.length, "건");

  console.log("\n   예시 (각 종류 1건씩):");
  const shown = new Set<string>();
  for (const i of allIssues) {
    if (shown.has(i.kind)) continue;
    shown.add(i.kind);
    console.log(`     [${i.kind}] ${i.detail ?? ""}`);
  }

  /* ---------------------------------------------------------- */
  if (DRY) {
    console.log(`\n${"─".repeat(64)}`);
    console.log("검증 모드로 끝났습니다. DB에는 아무것도 쓰지 않았습니다.");
    console.log("실제 적재: DATABASE_URL 설정 후 --dry-run 없이 실행하세요.");
    return;
  }

  const { load } = await import("./load");
  await load({ svc, prod, parts, cust, veh, stock, issues: allIssues });
}

main().catch((e) => {
  console.error("\n❌ 이관 실패:", e);
  process.exit(1);
});
