/**
 * 배터리 호환 코드 · 적용 차종 채우기 (2026-08-14 사장님 지시)
 *
 *   "호환 코드 검색되게 품목에 넣어줘"
 *
 * 배터리는 브랜드마다 이름이 달라서(한국 HK80DL = 델코 DIN80L = 로케트 GB58014 =
 * 엑스프로 XP58043 = CMF58014) 명세서나 손님이 말한 이름으로는 우리 품목을 못 찾는다.
 * 부품몰 상품목록의 배터리 상품명 안에 **호환표가 통째로 들어 있어서**
 * ("(GB56219),(CMF56219),(DIN60HL),(HK62DL)DIN타입_아반떼MD/AD,…") 그것을 읽어
 * 같은 자리 배터리끼리 묶고, fitment(적용 차종 = 부품 검색의 전부)에 적어 넣는다.
 *
 * 🔴 조심한 것 두 가지 (원본 자료가 완벽하지 않다)
 *   ① **일반타입과 DIN타입을 절대 섞지 않는다.** 부품몰 한 행이 DIN 자리에 일반
 *      코드(HK50L)를 잘못 적어 두어, 그냥 묶으면 50L(일반)과 DIN50L이 한 덩어리가
 *      된다. 물리적으로 다른 배터리라 잘못 끼우게 된다 → 타입별로 따로 묶는다.
 *   ② 그래도 남는 오타는 **한 행에만 나오고 자기 이름으로는 안 나오는 코드**를 빼서
 *      거른다 (2번 이상 나오거나 그 행의 대표 품번인 코드만 신뢰).
 *   ③ AGM(LN·RAGM)은 원본이 서로 어긋난다 — AGM60 을 LN2 로도, LN3 으로도 적어 두어
 *      그대로 묶으면 60Ah 와 70Ah 가 한 덩어리가 된다. 그래서 AGM 은 자동으로 묶지 않고
 *      아래 손으로 적은 용량표(AGM_GROUPS)를 쓴다. 적용 차종만 원본에서 가져온다.
 *
 * 실행:
 *   npx tsx scripts/battery-compat-260814.ts --dry   ← 대조만
 *   npx tsx scripts/battery-compat-260814.ts         ← 실제 반영
 * 다시 돌려도 안전 — fitment 를 매번 새로 만들어 덮어쓴다.
 */
import { config } from "dotenv";
import postgres from "postgres";
import * as XLSX from "xlsx";
import { readSheet } from "./lib/excel";

config({ path: ".env.local" });

const XLS_PATH = "C:\\Users\\info\\OneDrive\\문서\\통합자동화\\부품전체상품목록_260813.xls";
const DRY = process.argv.includes("--dry");

/** 코드 비교용 정규화 — 공백과 「L형/R형」 꼬리를 뗀다 */
function norm(code: string): string {
  return code.trim().replace(/\s+/g, "").replace(/[LR]형$/, "").toUpperCase();
}

/**
 * AGM 용량표 (손으로 적음 — 원본이 어긋나서).
 * 델코 LN2=60Ah · LN3=70 · LN4=80 · LN5=95 · LN6=105 이고,
 * 로케트 RAGM##·아트라스 AGM##DL 은 숫자가 곧 용량이다.
 * fitKey = 적용 차종을 가져올 부품몰 대표 품번.
 */
const AGM_GROUPS: { members: string[]; extra: string[]; fitKey: string }[] = [
  { members: ["LN2/60", "RAGM60", "AGM60DL"], extra: ["LN2", "AGM60"], fitKey: "AGM60" },
  { members: ["LN3/70", "RAGM70", "AGM70DL"], extra: ["LN3", "AGM70"], fitKey: "AGM70" },
  { members: ["LN4/80", "RAGM80", "AGM80DL"], extra: ["LN4", "AGM80L"], fitKey: "AGM80L" },
  { members: ["LN5/95", "RAGM95", "AGM95DL"], extra: ["LN5", "AGM95L"], fitKey: "AGM95L" },
  { members: ["LN6/105", "RAGM105", "AGM105DL"], extra: ["LN6", "AGM105"], fitKey: "AGM105" },
];

interface SrcRow {
  codes: string[];
  own: string;
  type: string; // '일반' | 'DIN' | 'AGM' | ''
  fit: string;
}

function readCompatRows(): SrcRow[] {
  let wb = XLSX.readFile(XLS_PATH, { cellDates: false });
  let sheet = readSheet(wb, wb.SheetNames[0]);
  if (!sheet.headers.includes("상품코드")) {
    wb = XLSX.readFile(XLS_PATH, { cellDates: false, codepage: 949 });
    sheet = readSheet(wb, wb.SheetNames[0]);
  }

  const out: SrcRow[] = [];
  for (const r of sheet.rows) {
    if (String(r["필터"] ?? "").trim() !== "배터리") continue;
    const name = String(r["상품명"] ?? "").trim();
    const own = String(r["품번"] ?? "").trim();
    if (!name || !own) continue;

    /**
     * ⚠️ 적용 차종 안에도 괄호가 있다 ("코나(가솔린)").
     *    그래서 **맨 앞에 붙어 있는 괄호만** 호환 코드로 읽는다.
     */
    const codes: string[] = [];
    let rest = name;
    for (;;) {
      const m = /^\s*\(([^)]*)\)\s*,?\s*/.exec(rest);
      if (!m) break;
      for (const c of m[1].split(",")) if (c.trim() && !/개발중/.test(c)) codes.push(c.trim());
      rest = rest.slice(m[0].length);
    }
    /** 괄호가 아니라 「GB55457,HK54DL,XP55457호환」 식으로 적힌 행도 있다 */
    if (codes.length === 0) {
      const m = /^([A-Za-z0-9,/\-]+)호환/.exec(rest);
      if (m) {
        for (const c of m[1].split(",")) if (c.trim()) codes.push(c.trim());
        rest = rest.slice(m[0].length);
      }
    }
    codes.push(own);
    // 「HK44DL가스마개 제거 필수」처럼 제 이름이 설명 앞에 붙어 있는 행
    if (rest.toUpperCase().startsWith(own.toUpperCase())) rest = rest.slice(own.length);

    rest = rest.replace(/^_/, "");
    let type = "";
    // 타입 표기가 문장 중간에 있는 행도 있다 ("R타입 단자 DIN타입_아이오닉 하이브리드")
    const tm = /(일반|DIN|AGM)타입_?/.exec(rest);
    if (tm) {
      type = tm[1];
      rest = (rest.slice(0, tm.index) + " " + rest.slice(tm.index + tm[0].length)).replace(/^\s*_/, "");
    } else {
      /**
       * 타입이 안 적힌 행은 대표 품번 모양으로 짐작한다.
       * DL·DR 끝 / DIN·CMF 시작 / 브랜드+5자리(GB55457·XP60038)는 DIN 규격이다.
       */
      type = /(?:DL|DR)$/i.test(own) || /^(DIN|CMF)/i.test(own) || /^(GB|XP|EG)\d{5}/i.test(own)
        ? "DIN"
        : "일반";
    }
    const fit = rest
      .replace(/핉수/g, "필수") // 원본 파일의 깨진 글자
      .replace(/\s*(가스마개\s*제거\s*필수|가스구멍\s*테이프\s*제거\s*필수!?)/g, " · $1")
      .replace(/\s+/g, " ")
      .trim();

    out.push({ codes, own, type, fit });
  }
  return out;
}

/** 일반·DIN 을 타입별로 따로 묶는다 (섞이면 안 되는 물건이다) */
function buildGroups(rows: SrcRow[]) {
  const key = (t: string, c: string) => `${t}|${norm(c)}`;
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x);
    if (p === undefined || p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(ra, rb);
  };

  /** 코드가 몇 번 나왔는지 · 어느 행의 대표 품번이었는지 (오타 거르기용) */
  const seen = new Map<string, number>();
  const isOwn = new Set<string>();

  const usable = rows.filter((r) => r.type === "일반" || r.type === "DIN");
  for (const row of usable) {
    isOwn.add(key(row.type, row.own));
    for (const c of row.codes) {
      const k = key(row.type, c);
      seen.set(k, (seen.get(k) ?? 0) + 1);
      if (!parent.has(k)) parent.set(k, k);
    }
    const ks = row.codes.map((c) => key(row.type, c));
    for (let i = 1; i < ks.length; i++) union(ks[0], ks[i]);
  }

  const groups = new Map<string, { codes: Set<string>; fit: string; type: string }>();
  for (const row of usable) {
    const root = find(key(row.type, row.codes[0]));
    let g = groups.get(root);
    if (!g) {
      g = { codes: new Set(), fit: "", type: row.type };
      groups.set(root, g);
    }
    for (const c of row.codes) {
      const k = key(row.type, c);
      // ⭐ 오타 거르기 — 두 번 이상 나왔거나, 어느 행의 대표 품번인 코드만 믿는다
      if ((seen.get(k) ?? 0) >= 2 || isOwn.has(k)) g.codes.add(c.trim());
    }
    if (row.fit.length > g.fit.length) g.fit = row.fit;
  }

  const byKey = new Map<string, { codes: Set<string>; fit: string; type: string }>();
  for (const k of parent.keys()) {
    const g = groups.get(find(k));
    if (g) byKey.set(k, g);
  }
  return { byKey, key };
}

/** AGM 은 원본 대신 용량표로 — 적용 차종만 원본에서 가져온다 */
function buildAgm(rows: SrcRow[]) {
  const fitByOwn = new Map<string, string>();
  for (const r of rows) {
    if (r.type !== "AGM" || !r.fit) continue;
    const k = norm(r.own);
    if ((fitByOwn.get(k)?.length ?? 0) < r.fit.length) fitByOwn.set(k, r.fit);
  }
  const byMember = new Map<string, { compat: string[]; fit: string }>();
  for (const g of AGM_GROUPS) {
    const fit = fitByOwn.get(norm(g.fitKey)) ?? "";
    for (const m of g.members) {
      const compat = [...g.members.filter((x) => x !== m), ...g.extra];
      byMember.set(norm(m), { compat, fit });
    }
  }
  return byMember;
}

async function main() {
  const rows = readCompatRows();
  const { byKey, key } = buildGroups(rows);
  const agm = buildAgm(rows);
  console.log(`부품몰 배터리 행 ${rows.length}개 읽음 (일반·DIN 묶음 ${new Set([...byKey.values()]).size}개, AGM 용량표 ${AGM_GROUPS.length}묶음)`);

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const prods = await sql<{ id: number; part_no: string; raw_name: string }[]>`
      SELECT id, part_no, raw_name FROM product
      WHERE item_type='part' AND category='배터리' AND part_no IS NOT NULL
      ORDER BY raw_name`;

    const updates: { id: number; partNo: string; fitment: string }[] = [];
    const unmatched: string[] = [];

    for (const p of prods) {
      const brandName = p.raw_name.split(" ")[0]; // 델코 · 로케트 · 한국 · 아트라스 · 에너자이저
      const base = norm(p.part_no);

      // ── AGM 먼저 (용량표)
      const a = agm.get(base);
      if (a) {
        const parts = [
          `${brandName} 배터리 AGM타입`,
          `호환 ${a.compat.join(" ")}`,
          a.fit,
          "매입가 VAT별도",
        ].filter(Boolean);
        updates.push({ id: p.id, partNo: p.part_no, fitment: parts.join(" · ").slice(0, 400) });
        continue;
      }

      /**
       * 우리 로케트 DIN 품목은 「DIN54459」로 적었지만 부품몰에는 「GB54459」로 실려 있다.
       * 델코는 부품몰도 DIN 이름을 쓰므로 그대로. 접두를 바꿔서도 찾아본다.
       */
      const cands = [base];
      if (brandName === "로케트" && base.startsWith("DIN")) cands.push("GB" + base.slice(3));

      // DIN 으로 보이면 DIN 부터, 아니면 일반부터 — 양쪽 다 없으면 못 맞춤
      const dinLike = /(?:DL|DR)$/.test(base) || base.startsWith("DIN");
      const order = dinLike ? ["DIN", "일반"] : ["일반", "DIN"];
      let g: { codes: Set<string>; fit: string; type: string } | undefined;
      let hitCand = "";
      outer: for (const t of order) {
        for (const c of cands) {
          const found = byKey.get(key(t, c));
          if (found) {
            g = found;
            hitCand = c;
            break outer;
          }
        }
      }
      if (!g) {
        unmatched.push(`${p.raw_name} (${p.part_no})`);
        continue;
      }

      const mine = new Set([...cands, hitCand].map(norm));
      const others = [...g.codes].filter((c) => !mine.has(norm(c))).sort();

      /**
       * ⭐ 「MF58043」 같은 표기로도 찾아지게 (사장님 목록이 이 모양이다).
       *    DIN 규격 번호는 브랜드마다 앞글자만 다르다 — CMF58014 · XP58043 · GB58014.
       *    배터리 라벨·명세서에는 앞글자 없이 MF+번호로 적히는 일이 잦아서 별칭으로 넣는다.
       *    (검색어일 뿐, 새 상품을 만들지는 않는다)
       */
      const nums = new Set<string>();
      for (const c of [...g.codes, ...cands]) for (const m of c.matchAll(/\d{5}/g)) nums.add(m[0]);
      const aliases = [...nums].map((n) => `MF${n}`).filter((a) => !others.includes(a)).sort();
      others.push(...aliases);
      const parts = [
        `${brandName} 배터리 ${g.type}타입`,
        others.length ? `호환 ${others.join(" ")}` : "",
        g.fit,
        "매입가 VAT별도",
      ].filter(Boolean);
      updates.push({ id: p.id, partNo: p.part_no, fitment: parts.join(" · ").slice(0, 400) });
    }

    console.log(`\n배터리 ${prods.length}종 → 채울 것 ${updates.length}종 / 못 맞춘 것 ${unmatched.length}종`);
    if (unmatched.length) console.log("못 맞춤(기존 설명 그대로 둠):\n  " + unmatched.join("\n  "));

    console.log("\n--- 표본 (사장님이 물어보신 코드) ---");
    for (const probe of ["HK100DL", "HK80DL", "HK62DL", "HK50DL", "HK50L", "DIN74R", "DF80L", "LN4/80"]) {
      const u = updates.find((x) => x.partNo === probe);
      console.log(` ${probe}: ${u ? u.fitment.slice(0, 175) : "(못 맞춤)"}`);
    }

    if (DRY) {
      console.log("\n--dry: 여기까지. 쓰기 없음");
      return;
    }
    for (const u of updates) {
      await sql`UPDATE product SET fitment = ${u.fitment}, updated_at = now() WHERE id = ${u.id}`;
    }
    console.log(`\n✅ ${updates.length}종에 호환 코드·적용 차종을 넣었습니다`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
