/**
 * ⭐ 간편결제 결제수단 신설 (사장님 요청 2026-08-29)
 *
 *   "새로운 결제방식이 필요함. 간편결제 방식(QR 코드나 네이버페이, 카카오페이, 토스페이 등).
 *    카드 단말기로 계산해도 여신협회에는 안나오는듯. pos기에는 저장이 되어서
 *    현재처럼 매출리포트에 기록이 되어있음."
 *
 *   실측(2026-08-28 토스 포스 매출리포트): QR결제 7줄 — 토스페이 305,000 · 현대 120,000 ·
 *   삼성 200,000 + 승인·취소 2쌍. 여신협회 승인내역에는 안 잡힌다.
 *
 *   ⚠️ 코드 배포 **전에** 돌려야 한다. 제약을 안 풀고 배포하면 간편결제 판매가 저장 실패한다.
 *   실행: npx tsx scripts/add-easypay.ts (다시 돌려도 안전)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    // ① 판매 헤더 — 혼합·외상·서비스까지 있는 전체 목록
    await sql`ALTER TABLE quote DROP CONSTRAINT IF EXISTS quote_payment_method`;
    await sql`
      ALTER TABLE quote ADD CONSTRAINT quote_payment_method
      CHECK (payment_method IS NULL OR payment_method IN
        ('현금','카드','계좌이체','지역화폐','간편결제','외상','혼합','서비스'))
    `;
    console.log("✅ quote.payment_method — 간편결제 추가");

    // ② 분할 결제 — 섞을 수 있는 수단만
    await sql`ALTER TABLE quote_payment DROP CONSTRAINT IF EXISTS quote_payment_method_check`;
    await sql`
      ALTER TABLE quote_payment ADD CONSTRAINT quote_payment_method_check
      CHECK (method IN ('현금','카드','계좌이체','지역화폐','간편결제'))
    `;
    console.log("✅ quote_payment.method — 간편결제 추가");

    // ③ 외상 수금
    await sql`ALTER TABLE receivable_payment DROP CONSTRAINT IF EXISTS receivable_payment_method_check`;
    await sql`
      ALTER TABLE receivable_payment ADD CONSTRAINT receivable_payment_method_check
      CHECK (method IN ('현금','카드','계좌이체','지역화폐','간편결제'))
    `;
    console.log("✅ receivable_payment.method — 간편결제 추가");

    /* ④ 같은 POS 건을 같은 판매에 두 번 붙이지 못하게 (2026-08-29)
       autoMatchPosDayCore 의 INSERT 에는 중복 방지가 없었다 — 수동(linkPos)에만 있었다.
       🔴 열쇠는 「짝」이다. src_id 하나로 잡으면 안 된다 — 카드 한 번 긁어 판매 두 건을
          치르는 경우(POS 1건 = 앱 여러 건)를 막아 버린다. 그건 금액을 나눠 두 줄로 적는다.
       🔴 이미 겹친 자국이 있으면 인덱스가 안 만들어진다. 먼저 지운다 (가장 오래된 것만 남김). */
    const dup = await sql`
      DELETE FROM recon_match a USING recon_match b
      WHERE a.kind = '포스결제' AND b.kind = '포스결제'
        AND a.src_table = b.src_table AND a.src_id = b.src_id
        AND a.ref_table = b.ref_table AND a.ref_id = b.ref_id
        AND a.id > b.id
      RETURNING a.id
    `;
    if (dup.length > 0) console.log(`🔴 겹친 포스결제 자국 ${dup.length}건을 지웠습니다 (가장 오래된 것만 남김)`);
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_match_pos
      ON recon_match (src_table, src_id, ref_table, ref_id) WHERE kind = '포스결제'
    `;
    console.log("✅ recon_match — 포스결제 자국 중복 방지 인덱스 (짝 단위)");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
