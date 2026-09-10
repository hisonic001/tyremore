/**
 * ⭐ 거래처별 청구서 양식 표 (사장님 실제 엑셀 반영 2026-09-10)
 *
 *   「9월 렌트카 수리비.xlsx」를 열어 보니 **양식이 거래처마다 달랐다**:
 *     쏘카       번호 | 차량번호 | 점검내용 | 정비금액 | 최종금액 | 승인금액 | 등록
 *     AJ         차량번호 | 점검내용 | 정비금액 | 최종승인금액 | 정비완료 | 결제승인 | VAT포함금액
 *     레드캡     차량번호 | 점검내용 | 점검비 | 최종금액 | 정비완료 | 팀장승인
 *     현대캐피탈 차량번호 | 점검내용 | 공급가격(VAT 별도) | 공급가격(VAT포함) | 승인
 *
 *   앱에는 실측 기본값이 코드로 들어 있어(settlement-sheet.ts BUILT_IN) 이 표가
 *   없어도 잘 나간다. 이 표는 **거래처가 양식을 바꿨을 때 코드 없이 고치는 자리**다
 *   — 있으면 이쪽이 정본이 된다.
 *
 * 🔴 control_fee_rate = 관제비율 (카랑에서 떼는 수수료). 쏘카 0.05.
 *    **앱 DB의 금액은 이미 관제비 차감 후**라서(실측: 194허9782 엔진오일
 *    quote_item.final_price 48,545 = 엑셀 「최종금액」, 엑셀 「정비금액」 51,100)
 *    청구서의 정가 칸은 ÷(1−rate) 로 역산해 만든다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/add-settle-format.ts   (멱등)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { builtInFormat } from "@/lib/settlement-sheet";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS settlement_format (
      id bigserial PRIMARY KEY,
      supplier_name text NOT NULL,
      /* 관제비율 0 ~ 0.9999 — 정가 역산에 쓴다 */
      control_fee_rate numeric(5,4) NOT NULL DEFAULT 0
        CHECK (control_fee_rate >= 0 AND control_fee_rate < 1),
      /* [{ key, label, width, merge }] — key 는 settlement-sheet.ts 의 InvoiceColKey */
      columns jsonb NOT NULL,
      sheet_name text,
      note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_format ON settlement_format (supplier_name)
  `);

  /* 실제로 외상 거래가 있는 이름들 — 「오픈링크[AJ렌트카]」처럼 적어 오신 이름도 잡는다 */
  const names = await db.execute<{ name: string }>(sql`
    SELECT DISTINCT name FROM (
      SELECT name FROM supplier WHERE is_active
      UNION
      SELECT DISTINCT COALESCE(supplier_name, claim_party) name FROM quote
      WHERE payment_method = '외상' AND COALESCE(supplier_name, claim_party) IS NOT NULL
    ) t
  `);

  let seeded = 0;
  for (const { name } of names) {
    const f = builtInFormat(name);
    if (!f) continue; // 실측 양식이 없는 거래처는 공용 양식 그대로
    await db.execute(sql`
      INSERT INTO settlement_format (supplier_name, control_fee_rate, columns, sheet_name, note)
      VALUES (${name}, ${f.controlFeeRate}, ${JSON.stringify(f.columns)}::jsonb, ${f.sheetName ?? null}, ${f.note ?? null})
      ON CONFLICT (supplier_name) DO NOTHING
    `);
    seeded++;
  }

  const [chk] = await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM settlement_format`);
  console.log(`✅ 청구서 양식 표 준비 완료 — 실측 양식 ${seeded}곳 확인, 지금 ${chk.n}줄`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => setTimeout(() => process.exit(0), 500));
