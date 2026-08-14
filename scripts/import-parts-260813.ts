/**
 * 부품 목록·매입가 일괄 업데이트 (2026-08-14 사장님 지시)
 *
 * 자료 1: 부품몰 「부품전체상품목록_260813.xls」 (통합자동화 폴더)
 *   - 「판매가」열 = **우리가 사오는 매입가** (사장님 확인 2026-08-14)
 *   - 필터류 + 브레이크패드만 적용, 그 외 분류(센서·와이퍼·배터리 등)는 무시
 *   - 상품명에 적용차종이 들어 있다 → fitment 로 (품번도 붙여 검색되게)
 * 자료 2: 「배터리가격.png」 (싸군배터리 2025-06-14 공급가, **VAT 별도**)
 *   - 델코·로케트·한국·아트라스AGM 전품목, 엑스프로XP 만 제외 (사장님 결정)
 *   - 아래 BATTERIES 표는 PNG 를 그대로 옮겨 적은 것
 *
 * 기표가(list_price)는 **비워둔다** — 판매 때 입력 (사장님 결정).
 *
 * 실행:
 *   npx tsx scripts/import-parts-260813.ts --dry   ← 집계만 (쓰기 없음)
 *   npx tsx scripts/import-parts-260813.ts         ← 실적용
 * 다시 돌려도 안전 — part_no 로 찾아 갱신한다.
 */
import { config } from "dotenv";
import postgres from "postgres";
import * as XLSX from "xlsx";
import { readSheet } from "./lib/excel";

config({ path: ".env.local" });

const XLS_PATH = "C:\\Users\\info\\OneDrive\\문서\\통합자동화\\부품전체상품목록_260813.xls";
const DRY = process.argv.includes("--dry");

/** 적용할 분류 → 앱 category / position. 여기 없는 분류는 전부 무시 */
const INCLUDE: Record<string, { category: string; position?: string }> = {
  에어필터: { category: "에어필터" },
  에어컨필터: { category: "에어컨필터" },
  "에어컨필터(활성탄)": { category: "에어컨필터" },
  오일필터: { category: "오일필터" },
  연료필터: { category: "연료필터" },
  "연료필터(ASSY)": { category: "연료필터" },
  상용차필터: { category: "상용차필터" },
  "브레이크(앞패드)": { category: "브레이크패드", position: "앞" },
  "브레이크(뒷패드)": { category: "브레이크패드", position: "뒤" },
  "브레이크 패드": { category: "브레이크패드" },
};

/** 배터리가격.png (2025-06-14 싸군배터리, 공급가 VAT 별도) — 엑스프로XP 제외 */
const BATTERIES: [brand: string, series: string, name: string, price: number][] = [
  // ── 델코 일반 DF
  ["델코", "일반", "DF40L", 51700], ["델코", "일반", "DF40R", 51700], ["델코", "일반", "DF40AL", 49900],
  ["델코", "일반", "DF50L", 59300], ["델코", "일반", "DF60L", 72400], ["델코", "일반", "DF60R", 73800],
  ["델코", "일반", "DF80L", 78900], ["델코", "일반", "DF80R", 80200], ["델코", "일반", "DF90L", 82900],
  ["델코", "일반", "DF90R", 82900], ["델코", "일반", "DF100L", 96100], ["델코", "일반", "DF100R", 96100],
  ["델코", "일반", "DF100BR", 101800], ["델코", "일반", "DF100D", 113100], ["델코", "일반", "DF120L", 128500],
  ["델코", "일반", "DF120R", 128500], ["델코", "일반", "DF150L", 133000], ["델코", "일반", "DF170L", 149300],
  ["델코", "일반", "DF170R", 149300], ["델코", "일반", "DF200L", 171800],
  ["델코", "일반", "DF250L(75019)", 202200], ["델코", "일반", "DF250R(75018)", 202200],
  // ── 델코 DIN
  ["델코", "DIN", "DIN50L", 55900], ["델코", "DIN", "DIN60L", 71100], ["델코", "DIN", "DIN60HL", 71100],
  ["델코", "DIN", "DIN74L", 74300], ["델코", "DIN", "DIN74R", 77700], ["델코", "DIN", "DIN90L", 95000],
  ["델코", "DIN", "DIN100L", 103800], ["델코", "DIN", "DIN115L", 123000], ["델코", "DIN", "DIN80L", 78900],
  // ── 델코 전용
  ["델코", "전용", "DF65-900", 106400], ["델코", "전용", "75B24LS", 74300],
  ["델코", "전용", "천화장사45L", 39800], ["델코", "전용", "DF택시80L", 71400],
  // ── 델코 AGM
  ["델코", "AGM", "LN2/60", 99900], ["델코", "AGM", "LN3/70", 118600], ["델코", "AGM", "LN4/80", 135400],
  ["델코", "AGM", "LN5/95", 169800], ["델코", "AGM", "LN6/105", 217500],
  // ── 델코 딥사이클
  ["델코", "딥사이클", "DC24", 94600], ["델코", "딥사이클", "DC27", 112400], ["델코", "딥사이클", "DC31", 128700],
  // ── 로케트 일반 GB
  ["로케트", "일반", "GB40L", 50900], ["로케트", "일반", "GB40R", 50900], ["로케트", "일반", "GB40AL", 50900],
  ["로케트", "일반", "GB50L", 59900], ["로케트", "일반", "GB60AL", 72800], ["로케트", "일반", "GB60R", 72800],
  ["로케트", "일반", "GB80L", 78900], ["로케트", "일반", "GB80R", 78900], ["로케트", "일반", "GB90L", 83700],
  ["로케트", "일반", "GB90R", 83700], ["로케트", "일반", "GB100L", 96700], ["로케트", "일반", "GB100R", 96700],
  ["로케트", "일반", "GB100BR", 96900], ["로케트", "일반", "GB120L", 131300], ["로케트", "일반", "GB120R", 131300],
  ["로케트", "일반", "GB150L", 137700], ["로케트", "일반", "GB170L/67019", 155800],
  ["로케트", "일반", "GB170R/67018", 171700], ["로케트", "일반", "GB200L", 181800], ["로케트", "일반", "GB250L", 230000],
  // ── 로케트 DIN
  ["로케트", "DIN", "DIN54459", 55900], ["로케트", "DIN", "DIN55457", 66400],
  ["로케트", "DIN", "DIN55066 L형", 57900], ["로케트", "DIN", "DIN55065 R형", 57900],
  ["로케트", "DIN", "DIN56219", 72300], ["로케트", "DIN", "DIN56318", 74900],
  ["로케트", "DIN", "DIN57820", 76400], ["로케트", "DIN", "DIN57219 R형", 79600],
  ["로케트", "DIN", "DIN59042", 95800], ["로케트", "DIN", "GB95R", 95800], ["로케트", "DIN", "DIN60044", 106800],
  // ── 로케트 전용
  ["로케트", "전용", "TILLER45L(농기계)", 40400], ["로케트", "전용", "12M24", 37000],
  ["로케트", "전용", "GB L6", 133300], ["로케트", "전용", "GB450L", 57000],
  ["로케트", "전용", "GB-NX100-S6L", 60600], ["로케트", "전용", "65-114", 99800],
  ["로케트", "전용", "FS200(선박용)", 180400],
  // ── 로케트 AGM
  ["로케트", "AGM", "RAGM60", 104300], ["로케트", "AGM", "RAGM70", 119300], ["로케트", "AGM", "RAGM80", 136300],
  ["로케트", "AGM", "RAGM95", 173200], ["로케트", "AGM", "RAGM105", 221500],
  // ── 한국 일반 HK
  ["한국", "일반", "HK40L", 43600], ["한국", "일반", "HK40R", 43600], ["한국", "일반", "HK40FL", 43600],
  ["한국", "일반", "HK50L", 51600], ["한국", "일반", "HK60L", 62900], ["한국", "일반", "HK60R", 62900],
  ["한국", "일반", "HK80L", 68400], ["한국", "일반", "HK80R", 68400], ["한국", "일반", "HK90L", 72500],
  ["한국", "일반", "HK90R", 72500], ["한국", "일반", "HK100L", 84200], ["한국", "일반", "HK100R", 84200],
  ["한국", "일반", "HK100BR", 85000], ["한국", "일반", "HK120L", 115200], ["한국", "일반", "HK120R", 115200],
  ["한국", "일반", "HK150L", 122000], ["한국", "일반", "HK170L", 137300], ["한국", "일반", "HK170R", 158000],
  ["한국", "일반", "HK200L", 157900],
  // ── 한국 DIN
  ["한국", "DIN", "HK44DL", 48100], ["한국", "DIN", "HK50DL", 51000], ["한국", "DIN", "HK54DL", 57600],
  ["한국", "DIN", "HK62DL", 63700], ["한국", "DIN", "HK74DL", 66000], ["한국", "DIN", "HK74DR", 66000],
  ["한국", "DIN", "HK80DL", 75200], ["한국", "DIN", "HK90DL", 82600], ["한국", "DIN", "HK90DR", 82600],
  ["한국", "DIN", "HK100DL", 93300],
  // ── 한국 전용
  ["한국", "전용", "AGM 46B24R", 93600], ["한국", "전용", "BX 50B24LS(농기계)", 49200],
  ["한국", "전용", "AX45L(농기계)", 34300], ["한국", "전용", "BX12N24", 31800],
  ["한국", "전용", "BX110L", 96500], ["한국", "전용", "TX80L(택시)", 69400],
  ["한국", "전용", "BX14", 37800], ["한국", "전용", "BX15", 40300],
  // ── 아트라스 AGM
  ["아트라스", "AGM", "AGM60DL", 94900], ["아트라스", "AGM", "AGM70DL", 106700],
  ["아트라스", "AGM", "AGM80DL", 121800], ["아트라스", "AGM", "AGM95DL", 152700],
  ["아트라스", "AGM", "AGM105DL", 193900],
];

interface Item {
  partNo: string;
  category: string;
  position: string | null;
  fitment: string;
  rawName: string;
  purchasePrice: number | null;
  supplierCode: string;
}

function toWon(v: unknown): number | null {
  const n = Math.round(Number(String(v ?? "").replace(/,/g, "").trim()));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 엑셀 → 대상 품목. 박스 행 제외, NICE 코드 중복은 싼 것 하나만 */
function readParts(): { items: Item[]; skippedBox: string[]; dups: string[] } {
  // ⚠️ 이 .xls 는 코드페이지 선언이 틀려 있다 (xlrd 도 cp949 강제 필요했음).
  //    한글 헤더가 안 읽히면 949 로 다시 읽는다.
  let wb = XLSX.readFile(XLS_PATH, { cellDates: false });
  let sheet = readSheet(wb, wb.SheetNames[0]);
  if (!sheet.headers.includes("상품코드")) {
    wb = XLSX.readFile(XLS_PATH, { cellDates: false, codepage: 949 });
    sheet = readSheet(wb, wb.SheetNames[0]);
    if (!sheet.headers.includes("상품코드")) {
      throw new Error(`헤더를 못 읽었다: ${sheet.headers.join(", ")}`);
    }
  }

  const byNo = new Map<string, Item>();
  const skippedBox: string[] = [];
  const dups: string[] = [];

  for (const r of sheet.rows) {
    const conf = INCLUDE[String(r["필터"] ?? "").trim()];
    if (!conf) continue; // 대상 외 분류 (센서·와이퍼·배터리·엔진오일 …)

    const nice = String(r["NICE"] ?? "").trim();
    const name = String(r["상품명"] ?? "").trim();
    if (!nice || !name) continue;

    /**
     * ⚠️ "(참고사항)1BOX = 40EA" 는 **낱개 가격**에 박스 입수량을 적어 둔 것 —
     *    제외하면 안 된다 (처음에 제외했다가 26300-35505 가 2,310원 대신
     *    순정 4,070원으로 잡히는 것을 표본 검증에서 잡았다).
     *    진짜 박스 단위 상품은 "(순정부품1BOX)" 표기뿐이다. 그 밖의 박스 변형은
     *    같은 코드의 낱개 행과 겹치므로 아래 「싼 값 남기기」가 걸러 준다.
     */
    if (/순정부품\s*1\s*BOX/i.test(name)) {
      skippedBox.push(`${nice} ${name.slice(0, 30)}`);
      continue;
    }

    const oemNo = String(r["품번"] ?? "").trim();
    const price = toWon(r["판매가"]);
    // 활성탄 여부는 분류에만 있고 이름에 없을 때가 있다 — 이름에 남긴다
    const carbon = String(r["필터"]).includes("활성탄") && !name.includes("활성탄") ? "(활성탄) " : "";
    const fitment = `${carbon}${name}${oemNo ? ` · 품번 ${oemNo}` : ""}`;

    const item: Item = {
      partNo: nice,
      category: conf.category,
      position: conf.position ?? null,
      fitment,
      rawName: `${conf.category} ${nice} (${name.slice(0, 40)})`,
      purchasePrice: price,
      supplierCode: "부품몰",
    };

    const prev = byNo.get(nice);
    if (prev) {
      dups.push(`${nice}: ${prev.purchasePrice ?? "-"}원 vs ${price ?? "-"}원`);
      // 낱개일 가능성이 높은 **싼 값**을 남긴다
      if (price !== null && (prev.purchasePrice === null || price < prev.purchasePrice)) byNo.set(nice, item);
    } else {
      byNo.set(nice, item);
    }
  }
  return { items: [...byNo.values()], skippedBox, dups };
}

function batteryItems(): Item[] {
  return BATTERIES.map(([brand, series, name, price]) => ({
    partNo: name,
    category: "배터리",
    position: null,
    // 공급가는 VAT 별도 금액임을 화면에서도 알 수 있게 남긴다
    fitment: `${brand} 배터리 ${series} · 매입가 VAT별도`,
    rawName: `${brand} ${name}`,
    purchasePrice: price,
    supplierCode: "싸군배터리",
  }));
}

/** NICE 코드에서 기존 part_no 와 맞춰 볼 후보들 */
function matchKeys(partNo: string): string[] {
  const keys = [partNo];
  const us = partNo.indexOf("_");
  if (us > 0) {
    keys.push(partNo.slice(0, us));
    const suffix = partNo.slice(us + 1);
    // 코드처럼 생긴 접미만 (SM192P·GP1134·CA299263 — 'MOBIS' 같은 단어는 제외)
    if (/^[A-Z]{1,3}\d+[A-Z]*$/.test(suffix)) keys.push(suffix);
  }
  return keys;
}

async function main() {
  const { items, skippedBox, dups } = readParts();
  const bats = batteryItems();
  const all = [...items, ...bats];

  console.log(`엑셀 대상 품목 ${items.length}개 (박스 제외 ${skippedBox.length}, 코드 중복 ${dups.length})`);
  console.log(`배터리 ${bats.length}개 (델코·로케트·한국·아트라스, 엑스프로 제외)`);
  const perCat = new Map<string, number>();
  for (const it of all) perCat.set(it.category, (perCat.get(it.category) ?? 0) + 1);
  console.log("분류별:", [...perCat.entries()].map(([c, n]) => `${c} ${n}`).join(" · "));
  if (dups.length) console.log("중복(검토용):\n  " + dups.join("\n  "));
  if (skippedBox.length) console.log("박스 제외:\n  " + skippedBox.join("\n  "));

  // 표본 — 값이 눈으로 맞는지
  for (const probe of ["MBA-001", "DF80L", "HK80L", "AGM95DL"]) {
    const hit = all.find((i) => i.partNo === probe || i.partNo.startsWith(probe + "_"));
    console.log(`표본 ${probe}:`, hit ? `${hit.purchasePrice}원 · ${hit.fitment.slice(0, 50)}` : "없음!");
  }

  if (DRY) {
    console.log("\n--dry: 여기까지. 쓰기 없음");
    return;
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const existing = await sql<{ id: number; part_no: string }[]>`
      SELECT id, part_no FROM product WHERE item_type = 'part' AND part_no IS NOT NULL`;
    const byPartNo = new Map<string, number>();
    for (const e of existing) if (!byPartNo.has(e.part_no)) byPartNo.set(e.part_no, e.id);

    let updated = 0;
    let inserted = 0;
    const claimed = new Set<number>(); // 같은 기존 상품을 두 행이 갱신하지 않게

    // 변형 없는 코드(МBA-001)가 변형(_MOBIS)보다 먼저 기존 상품을 차지한다
    const ordered = [...all].sort((a, b) => Number(a.partNo.includes("_")) - Number(b.partNo.includes("_")));

    await sql.begin(async (tx) => {
      for (const it of ordered) {
        let id: number | undefined;
        for (const k of matchKeys(it.partNo)) {
          const hit = byPartNo.get(k);
          if (hit !== undefined && !claimed.has(hit)) {
            id = hit;
            break;
          }
        }
        if (id !== undefined) {
          claimed.add(id);
          // 사장님이 손댄 display_name·attrs_override 는 안 건드린다
          await tx`UPDATE product SET
              purchase_price = ${it.purchasePrice},
              fitment = ${it.fitment},
              category = ${it.category},
              position = ${it.position},
              supplier_code = ${it.supplierCode},
              updated_at = now()
            WHERE id = ${id}`;
          updated++;
        } else {
          const [row] = await tx<{ id: number }[]>`INSERT INTO product
              (item_type, is_serialized, raw_name, part_no, fitment, position, category,
               purchase_price, supplier_code)
            VALUES ('part', false, ${it.rawName}, ${it.partNo}, ${it.fitment}, ${it.position},
               ${it.category}, ${it.purchasePrice}, ${it.supplierCode})
            RETURNING id`;
          byPartNo.set(it.partNo, row.id);
          claimed.add(row.id);
          inserted++;
        }
      }
    });

    console.log(`\n✅ 갱신 ${updated}개 · 신규 ${inserted}개 (기존 부품 ${existing.length}개 중)`);
    const [chk] = await sql<{ n: number; priced: number }[]>`
      SELECT count(*)::int n, count(purchase_price)::int priced FROM product WHERE item_type='part'`;
    console.log(`부품 상품 총 ${chk.n}개, 매입가 있는 것 ${chk.priced}개`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
