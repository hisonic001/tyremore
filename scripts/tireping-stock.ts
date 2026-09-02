/**
 * ⭐ 타이어핑 재고 반영 양식 만들기 (사장님 요청 2026-08-21)
 *
 *   "다른 타이어유통 플랫폼에서 내려받은 양식인데 현재 재고를 반영해서
 *    이 형식으로 만들어 엑셀파일로 올려서 재고를 바꾸고 싶어."
 *
 * 타이어핑에서 내려받은 「판매 재고현황」 파일을 읽어, **재고수량 칸만** 우리
 * 재고로 채워 같은 형식(.xls)으로 다시 쓴다. 나머지 칸은 손대지 않는다 —
 * 특히 A1 의 「※ 이 라인은 절대 삭제하시면 안됩니다」 줄에는 업로드를 우리
 * 계정과 잇는 토큰이 붙어 있다(내려받을 때마다 달라진다).
 *
 * 🔴 지키는 규칙 셋
 *
 *   ① **등록된 DOT 연도보다 새것만 판다.** 양식의 DOT 연도(G열)는 「기본정보
 *      (수정불가)」라 우리가 못 고친다. 2024년으로 등록된 자리에 2026년 물건을
 *      올리는 것은 손님에게 손해가 없지만, 그 반대는 안 된다.
 *
 *   ② **같은 물건이 여러 줄에 겹쳐 팔리지 않게 나눈다.** 같은 상품이 DOT 연도만
 *      다르게 두 줄로 등록돼 있는 경우가 있다. 줄마다 「연도 이상」으로 세면
 *      같은 타이어 4본이 두 줄에서 8본으로 팔린다 — 실제로 겹치는 줄이 있다.
 *      그래서 **등록 연도가 높은 줄부터 실물을 하나씩 배정**한다.
 *
 *   ③ **모르는 것은 팔지 않는다.** DOT 를 안 적어 둔 재고는 기본으로 뺀다
 *      (`--dot-unknown` 을 주면 넣는다 — 실물 DOT 를 확인하신 뒤에 쓰실 것).
 *
 * 쓰는 법:
 *   npx tsx scripts/tireping-stock.ts "C:/…/타이어핑.xls"
 *   … --dot-unknown                 DOT 없는 재고도 포함
 *   … --dry                         파일을 안 쓰고 보고만
 *   … --brand 미쉐린                그 제조사 줄만 채운다 (나머지 줄은 **손대지 않는다**)
 *   … --stock-file "재고.xlsx"      우리 DB 대신 **내려받은 재고 엑셀**과 맞댄다
 *                                   (「재고 엑셀 받기」의 새 형식 — 제조사 칸이 있어야 한다)
 */
import * as XLSX from "xlsx";
import path from "node:path";

/** 타이어핑 제조사 이름 → 우리 브랜드 코드. 라우펜은 한국타이어의 하위 상표다 */
const BRAND: Record<string, string> = {
  미쉐린: "MI",
  한국: "HK",
  라우펜: "HK",
  금호: "KM",
  콘티넨탈: "CO",
  굿이어: "GY",
  제너럴: "GN",
  넥센: "NX",
  피렐리: "PI",
  브리지스톤: "BS",
};
/** 우리 재고 엑셀의 「제조사」(한글 정식명) → 브랜드 코드 */
const BRAND_KO: Record<string, string> = {
  미쉐린: "MI",
  한국타이어: "HK",
  금호타이어: "KM",
  콘티넨탈: "CO",
  굿이어: "GY",
  제네럴타이어: "GN",
  넥센타이어: "NX",
  피렐리: "PI",
  브리지스톤: "BS",
};

/** 타이어핑 양식의 열 위치 (0부터). 양식이 바뀌면 여기만 고친다 */
const COL = { 상품ID: 0, 제조사: 2, 품명: 3, 사이즈: 4, DOT: 6, 제품코드: 7, 판매가: 10, 재고수량: 16 };
/** 데이터가 시작하는 줄 (0=경고줄, 1=묶음머리, 2=열이름, 3~=데이터) */
const FIRST_DATA_ROW = 3;

const norm = (s: unknown) =>
  String(s ?? "")
    .toUpperCase()
    .replace(/\([^)]*\)/g, "") // (W330A) 같은 괄호 코드는 뺀다 — 우리 이름엔 없다
    .replace(/[^A-Z0-9가-힣]/g, "");

interface StockProduct {
  code: string | null;
  brand: string | null;
  name: string;
  w: number;
  a: number;
  r: number;
  /** 연도별 남은 본수 — 배정하면서 깎는다. '없음' 은 DOT 미기록 */
  left: Map<string, number>;
  /** 처음 세었던 본수 (배정으로 깎이기 전) — 보고용 */
  total: number;
}

/** 우리 DB 에서 재고를 읽는다 */
async function stockFromDb(): Promise<StockProduct[]> {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const rows = await db.execute<{
    pid: number;
    code: string | null;
    brand_code: string | null;
    display_name: string | null;
    pattern: string | null;
    width: number | null;
    aspect_ratio: number | null;
    rim_inch: string | null;
    dot: string | null;
    n: number;
  }>(sql`
    SELECT p.id pid, p.mars_item_no code, p.brand_code, p.display_name, p.pattern,
           p.width, p.aspect_ratio, p.rim_inch, si.dot, count(*)::int n
      FROM stock_item si
      JOIN product p ON p.id = si.product_id
     WHERE si.status = '재고' AND si.qty > 0 AND p.item_type = 'tire'
     GROUP BY 1,2,3,4,5,6,7,8,9
  `);
  const byPid = new Map<number, StockProduct>();
  for (const s of rows) {
    const pid = Number(s.pid);
    let e = byPid.get(pid);
    if (!e) {
      e = {
        code: s.code,
        brand: s.brand_code,
        name: s.display_name?.trim() || s.pattern?.trim() || "",
        w: Number(s.width),
        a: Number(s.aspect_ratio),
        r: parseFloat(String(s.rim_inch)),
        left: new Map(),
        total: 0,
      };
      byPid.set(pid, e);
    }
    // DOT 는 WWYY (4423 = 44주 2023년)
    const dot = String(s.dot ?? "");
    const year = /^\d{4}$/.test(dot) ? `20${dot.slice(2)}` : "없음";
    e.left.set(year, (e.left.get(year) ?? 0) + Number(s.n));
    e.total += Number(s.n);
  }
  return [...byPid.values()];
}

/**
 * 내려받은 재고 엑셀에서 읽는다 (DB 대신).
 * 「재고 엑셀 받기」의 **새 형식**이어야 한다 — 제조사 칸으로 브랜드를 안다.
 */
function stockFromFile(file: string): StockProduct[] {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  const get = (r: Record<string, unknown>, k: string) => String(r[k] ?? "").trim();
  const byNo = new Map<string, StockProduct>();
  let noBrand = 0;
  for (const r of rows) {
    const itemNo = get(r, "품번");
    const qty = Number(get(r, "수량").replace(/,/g, "")) || 0;
    if (!itemNo || qty <= 0) continue;
    const brandKo = get(r, "제조사");
    if (!brandKo) noBrand++;
    const spec = get(r, "규격");
    const m = spec.match(/(\d{3})\/(\d{2})R(\d{2}(?:\.\d)?)/);
    let e = byNo.get(itemNo);
    if (!e) {
      e = {
        code: itemNo, // 파일에는 상품ID 가 없다 — 품번이 곧 열쇠다
        brand: BRAND_KO[brandKo] ?? null,
        name: get(r, "모델"),
        w: m ? Number(m[1]) : Number(get(r, "폭")) || 0,
        a: m ? Number(m[2]) : Number(get(r, "편평비")) || 0,
        r: m ? parseFloat(m[3]) : Number(get(r, "인치")) || 0,
        left: new Map(),
        total: 0,
      };
      byNo.set(itemNo, e);
    }
    const dot = get(r, "DOT").replace(/\D/g, "");
    const year = dot.length === 4 ? `20${dot.slice(2)}` : "없음";
    e.left.set(year, (e.left.get(year) ?? 0) + qty);
    e.total += qty;
  }
  if (noBrand) {
    console.log(`⚠️ 제조사 칸이 빈 줄 ${noBrand} — 옛 형식 파일입니다. 「재고 엑셀 받기」로 다시 받아 주세요\n`);
  }
  return [...byNo.values()];
}

interface Line {
  rowIndex: number;
  brand: string;
  label: string;
  dotYear: number;
  product: StockProduct | null;
  how: string;
  qty: number;
  /** 이 줄을 손댈 것인가 (--brand 로 좁혔을 때 다른 제조사 줄은 건드리지 않는다) */
  mine: boolean;
}

async function main() {
  // ── 인자 ──────────────────────────────────────────────
  const argv = process.argv.slice(2);
  const VALUE_OPTS = ["--brand", "--stock-file"];
  const positional: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    if (VALUE_OPTS.includes(a)) values.set(a, argv[++i] ?? "");
    else flags.add(a);
  }
  const src = positional[0];
  const useNoDot = flags.has("--dot-unknown");
  const dry = flags.has("--dry");
  /* ⭐ --zero-others (사장님 요청 2026-09-02 "그 이외의 상품들은 일단 지워줘") —
     좁힌 제조사 밖의 줄은 재고수량을 0 으로 쓴다. 줄 삭제는 양식·토큰이 깨질 수
     있어 안 한다 — 재고 0 이 판매 내리기와 같은 효과다. */
  const zeroOthers = flags.has("--zero-others");
  const onlyBrand = values.get("--brand") ?? null;
  const stockFile = values.get("--stock-file") ?? null;
  if (!src) {
    console.log('쓰는 법: npx tsx scripts/tireping-stock.ts "타이어핑.xls" [--brand 미쉐린] [--stock-file "재고.xlsx"] [--dot-unknown] [--dry]');
    process.exit(1);
  }

  const wb = XLSX.readFile(src);
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const grid: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  const rows = grid
    .map((r, i) => ({ r, i }))
    .slice(FIRST_DATA_ROW)
    .filter((x) => String(x.r[COL.상품ID] ?? "").trim());

  const products = stockFile ? stockFromFile(stockFile) : await stockFromDb();

  // ── 줄 ↔ 상품 잇기 ────────────────────────────────────
  const lines: Line[] = rows.map(({ r, i }) => {
    const brand = String(r[COL.제조사] ?? "").trim();
    const name = String(r[COL.품명] ?? "").trim();
    const size = String(r[COL.사이즈] ?? "").trim();
    const code = String(r[COL.제품코드] ?? "").trim();
    const dotYear = Number(String(r[COL.DOT] ?? "").trim()) || 0;
    const mine = !onlyBrand || brand === onlyBrand;

    let product: StockProduct | null = null;
    let how = "";
    if (mine) {
      // ① 제품코드 = 우리 MARS 품번 (미쉐린 CAI). 가장 믿을 만하다
      if (code) {
        product = products.find((p) => p.code === code) ?? null;
        if (product) how = "품번";
      }
      // ② 브랜드 + 규격 + 이름. 미쉐린 아닌 것은 이 길뿐이다
      if (!product) {
        const m = size.match(/(\d{3})\/(\d{2})R(\d{2}(?:\.\d)?)/);
        const bc = BRAND[brand];
        if (m && bc) {
          const cands = products.filter(
            (p) => p.brand === bc && p.w === Number(m[1]) && p.a === Number(m[2]) && p.r === parseFloat(m[3]),
          );
          const want = norm(name);
          product =
            cands.find((p) => norm(p.name) === want) ??
            cands.find((p) => norm(p.name).includes(want) || want.includes(norm(p.name))) ??
            null;
          if (product) how = "규격+이름";
        }
      }
    }
    return { rowIndex: i, brand, label: `${brand} ${name} ${size}`, dotYear, product, how, qty: 0, mine };
  });

  /**
   * ⭐ 배정 — 같은 물건이 두 줄에 겹쳐 팔리지 않게 (규칙 ②).
   *    등록 DOT 연도가 **높은 줄부터** 실물을 가져간다. 낮은 줄은 남은 것만 받는다.
   */
  for (const line of [...lines].sort((x, y) => y.dotYear - x.dotYear)) {
    const p = line.product;
    /* ⭐ 등록 연식이 빈 줄(신규 등록 직후 꼴, 2026-09-02 실측)은 「연식 제한 없음」 —
       DOT 아는 재고면 아무 연도나 배정한다. 정렬상 연식 지정 줄이 먼저 가져간다. */
    if (!p || !line.mine) continue;
    let take = 0;
    for (const [year, n] of p.left) {
      if (n <= 0) continue;
      const ok = year === "없음" ? useNoDot : line.dotYear === 0 || Number(year) >= line.dotYear; // 규칙 ①·③ (연식 빈 줄은 제한 없음)
      if (!ok) continue;
      take += n;
      p.left.set(year, 0);
    }
    line.qty = take;
  }

  // ── 보고 ──────────────────────────────────────────────
  const target = lines.filter((l) => l.mine);
  const filled = target.filter((l) => l.qty > 0);
  const zeroMatched = target.filter((l) => l.product && l.qty === 0);
  const unmatched = target.filter((l) => !l.product);
  console.log(`타이어핑 양식 ${lines.length}줄 — ${path.basename(src)}`);
  console.log(`  재고 출처: ${stockFile ? path.basename(stockFile) : "우리 DB (지금 재고)"}`);
  if (onlyBrand) console.log(`  대상: 「${onlyBrand}」 ${target.length}줄만 — 나머지 ${lines.length - target.length}줄은 손대지 않습니다`);
  console.log(`  DOT 없는 재고: ${useNoDot ? "포함" : "제외 (--dot-unknown 으로 포함)"}\n`);

  console.log(`── 재고를 채운 줄 ${filled.length} (합 ${filled.reduce((s, l) => s + l.qty, 0)}본) ─────────`);
  for (const l of filled) console.log(`  ${String(l.qty).padStart(3)}본  DOT${l.dotYear}  ${l.label}  [${l.how}]`);

  console.log(`\n── 0 으로 두는 줄 ${zeroMatched.length + unmatched.length} ─────────`);
  for (const l of zeroMatched) {
    const rest = [...(l.product?.left ?? [])].filter(([, n]) => n > 0);
    const why = rest.length
      ? `재고는 있으나 등록 DOT(${l.dotYear})보다 옛것뿐 — ${rest.map(([y, n]) => `${y}:${n}본`).join(" ")}`
      : "다른 줄에 이미 배정됨";
    console.log(`  0본  DOT${l.dotYear}  ${l.label} — ${why}`);
  }
  for (const l of unmatched) console.log(`  0본  DOT${l.dotYear}  ${l.label} — 우리 재고에 없음`);

  /**
   * ⭐ 팔 수 있는데 타이어핑에 **등록 자체가 없는** 것 — 사장님이 새로 올리실 거리.
   *    이 파일로는 줄을 늘릴 수 없다(상품ID 가 있어야 한다) — 타이어핑 화면에서 등록해야 한다.
   */
  const listed = new Set(lines.filter((l) => l.product?.code).map((l) => l.product!.code));
  const wantBrand = onlyBrand ? (BRAND[onlyBrand] ?? null) : null;
  const notListed = products
    .filter((p) => !listed.has(p.code))
    .filter((p) => !wantBrand || p.brand === wantBrand)
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total);
  if (notListed.length) {
    const cap = onlyBrand ? notListed.length : 25; // 제조사를 좁혔으면 전부 보여준다
    console.log(
      `\n── 재고에는 있는데 타이어핑에 등록이 없는 ${onlyBrand ?? ""} 타이어 ${notListed.length}종 (합 ${notListed.reduce((s, p) => s + p.total, 0)}본) ─────────`,
    );
    for (const p of notListed.slice(0, cap)) {
      const ys = [...p.left.entries()].filter(([, n]) => n > 0).sort();
      const dots = ys.length ? ys.map(([y, n]) => `${y}:${n}`).join(" ") : "DOT 미기록";
      console.log(`  ${String(p.total).padStart(3)}본  ${p.code ?? "-"}  ${p.name} ${p.w}/${p.a}R${p.r}  (${dots})`);
    }
    if (notListed.length > cap) console.log(`  … 그 밖에 ${notListed.length - cap}종`);
  }

  if (dry) {
    console.log("\n(--dry 라 파일은 쓰지 않았습니다)");
    process.exit(0);
  }

  // ── 재고수량 칸만 고쳐 다시 쓴다 ───────────────────────
  let zeroed = 0;
  for (const l of lines) {
    if (!l.mine) {
      if (zeroOthers) {
        ws[XLSX.utils.encode_cell({ c: COL.재고수량, r: l.rowIndex })] = { t: "n", v: 0 };
        zeroed++;
      }
      continue; // 좁혔으면 남의 줄은 (zero-others 아니면) 원래 값 그대로 둔다
    }
    ws[XLSX.utils.encode_cell({ c: COL.재고수량, r: l.rowIndex })] = { t: "n", v: l.qty };
  }
  if (zeroed > 0) console.log(`
⭕ ${onlyBrand} 외 ${zeroed}줄은 재고 0 으로 내렸습니다 (판매 안 됨 — 줄 삭제 대신)`);
  const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10).replace(/-/g, "");
  const tag = onlyBrand ? `_${onlyBrand}` : "";
  const out = path.join(path.dirname(src), `타이어핑_재고반영${tag}_${stamp}.xls`);
  XLSX.writeFile(wb, out, { bookType: "biff8" });
  console.log(`\n✅ 만들었습니다: ${out}`);
  console.log("   타이어핑 「판매 재고현황」 화면에서 이 파일을 그대로 올리시면 됩니다.");
  process.exit(0);
}

main();
