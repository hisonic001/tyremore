/**
 * ⭐ 대행 정산처 ↔ 우리 거래처 짝 (사장님 확인 2026-09-10)
 *
 *   계산서를 끊는 상호와 앱의 거래처 이름이 다르다:
 *     ㈜카랑        → 쏘카 · 현대캐피탈   (품목 요약으로 갈린다)
 *     오픈링크㈜     → AJ렌트카
 *     ㈜레드캡투어   → 레드캡
 *   이 짝이 없으면 「이 청구의 계산서 짝」 후보가 엉뚱하게 넓어진다
 *   (실측: 개인택시지부 청구에 카랑 계산서가 후보로 올라왔다).
 *
 *   keyword 가 있으면 품목 요약에 그 말이 있을 때만 그 거래처로 본다 —
 *   한 대행사가 여러 거래처를 대신 끊기 때문(카랑이 쏘카와 현대캐피탈 둘 다).
 *
 * 실행: npx tsx --env-file=.env.local scripts/add-agency-map.ts   (멱등)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agency_map (
      id bigserial PRIMARY KEY,
      counterparty_name text NOT NULL,
      keyword text,
      supplier_name text NOT NULL,
      memo text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (counterparty_name, keyword, supplier_name)
    )
  `);

  const seeds: { counter: string; keyword: string | null; supplier: string; memo?: string }[] = [
    { counter: "카랑", keyword: "쏘카", supplier: "쏘카", memo: "㈜카랑이 「○월 쏘카 수리비」로 끊는다" },
    { counter: "카랑", keyword: "현대캐피탈", supplier: "현대캐피탈", memo: "㈜카랑이 「현대캐피탈 타이어」로 끊는다" },
    { counter: "오픈링크", keyword: null, supplier: "AJ렌트카", memo: "오픈링크㈜가 「○월 차량 수리비」로 끊는다" },
    { counter: "레드캡투어", keyword: null, supplier: "레드캡", memo: "㈜레드캡투어 — AJ와 별개 거래처" },
  ];

  let added = 0;
  for (const s of seeds) {
    const r = await db.execute<{ id: number }>(sql`
      INSERT INTO agency_map (counterparty_name, keyword, supplier_name, memo)
      VALUES (${s.counter}, ${s.keyword}, ${s.supplier}, ${s.memo ?? null})
      ON CONFLICT (counterparty_name, keyword, supplier_name) DO NOTHING
      RETURNING id
    `);
    added += r.length;
  }
  const [n] = await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM agency_map`);
  console.log(`agency_map ${n.n}건(새로 ${added}) — 준비됨`);
  process.exit(0);
}
main();
