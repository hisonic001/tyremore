/**
 * 통장 적요 이름 ↔ 계산서 상대 별명 심기 (사장님 승인 2026-08-25)
 *
 *   실측으로 드러난 문제: 계산서 상호와 통장 적요 이름이 아예 다른 거래처가 많다.
 *     금호타이어 주식회사      ↔ 「조준호A금호타」   (출금 3억 3,822만원)
 *     콘티넨탈타이어코리아      ↔ 「콘티_(주)싸이」   (8,211만원)
 *     강남세차장카센타          ↔ 「최선종(강남세」
 *     쌍성트레이딩              ↔ 「임훈규(쌍성트」
 *   그래서 「출금 검색」에 상호를 쳐도 0건이 나왔다. 여기서 한 번에 심는다.
 *
 *   심는 것:
 *     ① party_alias  `<정규화한 적요이름>@<사업자번호>` → 'T:<사업자번호>'
 *        (계산서 화면이 지급 출금을 ★로 알아보는 열쇠)
 *     ② supplier.biz_no (비어 있을 때만) — 거래처 자동 인식
 *
 *   npx tsx scripts/seed-payer-alias.ts   (멱등 — 여러 번 돌려도 안전)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

/** recon-data.normName 과 같은 규칙 (스크립트는 앱 import 없이 독립 실행) */
const norm = (s: string) =>
  String(s ?? "").replace(/㈜|\(주\)|주식회사|\s/g, "").toLowerCase();
/** expense-cats.payerKeyOf("통장", …) 와 같은 규칙 */
const payerOf = (d: string) => d.replace(/^\[[^\]]*\]\s*/, "").trim();

/** 계산서 상호 ↔ 통장 적요를 찾을 패턴 (실데이터 역추적으로 확정) */
const MAP: { invoiceName: string; bankLike: string; supplier?: string }[] = [
  { invoiceName: "금호타이어 주식회사", bankLike: "%금호타%", supplier: "금호" },
  { invoiceName: "콘티넨탈타이어코리아 유한회사", bankLike: "%콘티\\_%", supplier: "콘티넨탈" },
  { invoiceName: "강남세차장카센타", bankLike: "%강남세%", supplier: "강릉 강남세차장카센터" },
  { invoiceName: "쌍성트레이딩", bankLike: "%쌍성트%", supplier: "쌍성 타이어" },
  { invoiceName: "일리터 오토컴퍼니", bankLike: "%일리터%" },
  { invoiceName: "주식회사 딜러타이어", bankLike: "%딜러타이어%" },
  { invoiceName: "스칼릿 주식회사", bankLike: "%스칼릿%" },
  { invoiceName: "미쉐린코리아(주)", bankLike: "%미쉐린코리아%", supplier: "미쉐린" },
  { invoiceName: "주식회사 맥스런", bankLike: "%맥스런%", supplier: "타이어핑" },
  { invoiceName: "주식회사 위즈오토코리아", bankLike: "%위즈%", supplier: "위즈오토" },
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  let aliasN = 0;
  let bizN = 0;
  try {
    for (const m of MAP) {
      // 사업자번호 — 계산서에서
      const [inv] = await sql<{ biz: string }[]>`
        SELECT counterparty_biz_no biz FROM tax_invoice
        WHERE is_active AND counterparty_name = ${m.invoiceName} LIMIT 1`;
      if (!inv) {
        console.log(`· ${m.invoiceName}: 계산서 없음 — 건너뜀`);
        continue;
      }
      // 통장 적요 이름들 (출금 기준, 많이 쓰인 순)
      const payers = await sql<{ description: string; n: number }[]>`
        SELECT description, count(*)::int n FROM cash_txn
        WHERE source = '통장' AND is_active AND out_amount > 0 AND description ILIKE ${m.bankLike}
        GROUP BY 1 ORDER BY 2 DESC LIMIT 8`;
      const keys = new Set<string>();
      for (const p of payers) {
        const key = norm(payerOf(p.description));
        if (key.length < 2 || keys.has(key)) continue;
        keys.add(key);
        await sql`
          INSERT INTO party_alias (alias_key, alias_raw, party_key, party_label)
          VALUES (${key + "@" + inv.biz}, ${payerOf(p.description)}, ${"T:" + inv.biz},
                  ${"지급출금 " + m.invoiceName})
          ON CONFLICT (alias_key) DO UPDATE SET party_key = EXCLUDED.party_key,
            party_label = EXCLUDED.party_label, updated_at = now()`;
        aliasN++;
      }
      // 거래처에 사업자번호 기억 (비어 있을 때만)
      if (m.supplier) {
        const done = await sql<{ id: number }[]>`
          UPDATE supplier SET biz_no = ${inv.biz}
          WHERE name = ${m.supplier} AND biz_no IS NULL RETURNING id`;
        if (done.length > 0) bizN++;
      }
      console.log(`· ${m.invoiceName} (${inv.biz}) ← ${[...keys].join(" / ") || "적요 못 찾음"}`);
    }
    console.log(`\n✅ 별명 ${aliasN}개 · 거래처 사업자번호 ${bizN}개 기억함`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
