import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

type Row = {
  id: number;
  mars: string | null;
  name: string;
  ar: number | null;
  li: string | null;
  sr: string | null;
  lp: number | null;
  active: boolean;
  stock: number;
  sales: number;
  buys: number;
  dict: number;
  key: string; // 브랜드|폭|편평비(80=없음)|인치
  label: string;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const rows = await sql<Row[]>`
    WITH used AS (
      SELECT DISTINCT product_id AS id FROM stock_item WHERE product_id IS NOT NULL
      UNION SELECT DISTINCT product_id FROM quote_item WHERE product_id IS NOT NULL
      UNION SELECT DISTINCT product_id FROM purchase_invoice_item WHERE product_id IS NOT NULL
      UNION SELECT DISTINCT product_id FROM supplier_item_code WHERE product_id IS NOT NULL
    )
    SELECT p.id, p.mars_item_no mars,
           COALESCE(NULLIF(p.display_name,''), p.pattern, p.raw_name) name,
           p.aspect_ratio ar, p.load_index li, p.speed_rating sr, p.list_price lp, p.is_active active,
           (SELECT COALESCE(SUM(s.qty),0) FROM stock_item s WHERE s.product_id=p.id AND s.status='재고')::int stock,
           (SELECT count(*) FROM quote_item qi WHERE qi.product_id=p.id)::int sales,
           (SELECT count(*) FROM purchase_invoice_item ii WHERE ii.product_id=p.id)::int buys,
           (SELECT count(*) FROM supplier_item_code sc WHERE sc.product_id=p.id)::int dict,
           p.brand_code || '|' || p.width || '|' || COALESCE(NULLIF(p.aspect_ratio,80)::text,'') || '|' || p.rim_inch key,
           COALESCE(b.name_ko, p.brand_code) || ' ' || p.width ||
             COALESCE('/' || NULLIF(p.aspect_ratio,80)::text, '') || 'R' ||
             regexp_replace(p.rim_inch::text, '.0$', '') label
    FROM product p JOIN used u ON u.id = p.id
    LEFT JOIN brand b ON b.code = p.brand_code
    WHERE p.item_type='tire' AND p.width IS NOT NULL AND p.rim_inch IS NOT NULL
    ORDER BY 12, p.id`;

  // 같은 브랜드+실규격(80≡없음) 묶음
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(r.key, [...(groups.get(r.key) ?? []), r]);

  const norm = (s: string) =>
    s.toLowerCase().replace(/\d{3}\s*\/?\s*\d{0,2}\s*z?r\s*\d{2}c?/g, "").replace(/[^a-z0-9가-힣]/g, "");
  // 구분 표기 — 사장님 원칙: OE·겹수·XL·런플랫·흡음·세대(EDGE/ADVANCE/+)는 다른 상품
  const sig = (r: Row) => {
    const t = ` ${r.name.toUpperCase()} `;
    const marks: string[] = [];
    for (const m of ["MO1","MOE","MO","GOE","AO","RO1","VOL","N0","N1","N2","ND0","T0","T1","MGT","LR","JLR"," J ","★","*"])
      if (t.includes(` ${m.trim()} `) || (m === "*" && /\s\*\s/.test(t))) marks.push(m.trim());
    const ply = /(\d{1,2})P(?=\s|$)/.exec(t)?.[1] ?? "";
    const xl = /\bXL\b/.test(t) ? "XL" : "";
    const rf = /(ZP|ZPS|RFT|ROF|SSR|R-F|EMT|DSST)/.test(t) ? "RF" : "";
    const ac = /(ACOUSTIC|흡음|SILENT)/.test(t) ? "AC" : "";
    const gen = /(EDGE|ADVANCE|\+)/.test(t) ? (t.match(/EDGE|ADVANCE|\+/g) ?? []).join("") : "";
    return `${marks.sort().join(",")}|${ply}|${xl}|${rf}|${ac}|${gen}`;
  };

  let sure = 0, twin = 0, variant = 0, vague = 0;
  const out: string[] = [];
  for (const [, g] of groups) {
    if (g.length < 2) continue;
    // 이름(규격 뗀 것) 기준 소묶음
    const byName = new Map<string, Row[]>();
    for (const r of g) byName.set(norm(r.name), [...(byName.get(norm(r.name)) ?? []), r]);

    for (const [, m] of byName) {
      if (m.length < 2) continue;
      const sameSig = new Set(m.map(sig)).size === 1;
      const sameLoad = new Set(m.map((r) => `${r.li ?? ""}${r.sr ?? ""}`.replace(/^$/, "?"))).size <= 1 ||
        m.some((r) => !r.li);
      const arMix = new Set(m.map((r) => r.ar === 80 ? null : r.ar)).size === 1 && new Set(m.map((r) => r.ar)).size > 1;
      const kind = sameSig && sameLoad ? (arMix ? "쌍둥이(80표기)" : "확실") : sameSig ? "애매(하중차)" : "변형주의";
      if (kind === "확실") sure++;
      else if (kind === "쌍둥이(80표기)") twin++;
      else if (kind === "변형주의") { variant++; continue; }
      else vague++;
      out.push(
        `【${kind}】 ${m[0].label} ${m[0].name}\n` +
          m
            .map(
              (r) =>
                `    #${r.id} ${r.mars ?? "품번없음"} «${r.name}» ` +
                `${r.li ?? "?"}${r.sr ?? ""} · 재고${r.stock} 판매${r.sales} 매입${r.buys} 사전${r.dict}` +
                `${r.lp ? ` · 기표가${r.lp.toLocaleString()}` : ""}${r.active ? "" : " · 숨김"}${r.ar !== null && r.ar !== 80 ? "" : r.ar === 80 ? " · ar80" : " · ar없음"}`,
            )
            .join("\n"),
      );
    }
  }
  console.log(`실사용 타이어 ${rows.length}개 검토 — 확실 ${sure}묶음 · 80표기 쌍둥이 ${twin}묶음 · 애매 ${vague}묶음 · (변형이라 제외 ${variant})`);
  console.log("");
  for (const o of out) console.log(o + "\n");
  await sql.end();
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
