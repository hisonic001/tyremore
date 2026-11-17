/**
 * ⭐ 자동 수집 받은 편지함 — intake_log (2026-11-17, D-41)
 *
 *   /api/intake 로 들어온 것은 **처리 결과와 상관없이 전부** 여기 먼저 남는다.
 *   (폰 은행 알림 · 메일 첨부: 미쉐린 인보이스 PDF · 홈택스 계산서 보안메일 · 카드 명세서 …)
 *   지금 못 읽는 것(콘티넨탈 PDF·카드 명세서)도 원본을 보관해 두었다가 읽는 법이 생기면 다시 처리한다.
 *
 *   ref 가 같으면 한 번만 — 알림 전달 앱·구글 스크립트가 같은 것을 두 번 보내도 안전하다.
 *
 *   npx tsx scripts/add-intake.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS intake_log (
        id           bigserial PRIMARY KEY,
        received_at  timestamptz NOT NULL DEFAULT now(),
        kind         text NOT NULL,              -- '은행알림' | '메일'
        sender       text,                       -- 메일 보낸 곳 / 알림 앱 이름
        subject      text,                       -- 메일 제목 / 알림 제목
        ref          text NOT NULL UNIQUE,       -- 메일ID#첨부번호 · 알림 글자의 sha1
        file_name    text,
        mime         text,
        body         text,                       -- 알림 글자 · 메일 본문(짧게)
        file_bytes   bytea,                      -- 첨부 원본 (못 읽은 것도 보관)
        status       text NOT NULL DEFAULT '대기',
        result       text,                       -- 사람이 읽을 한 줄 결과
        linked_table text,                       -- 'cash_txn' | 'tax_invoice' | 'purchase_invoice'
        linked_id    bigint,
        handled_at   timestamptz,
        CONSTRAINT intake_log_kind CHECK (kind IN ('은행알림','메일')),
        CONSTRAINT intake_log_status CHECK (status IN ('대기','반영','중복','보관','해석불가','오류'))
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_intake_log_received ON intake_log (received_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_intake_log_status ON intake_log (status) WHERE status IN ('대기','보관','해석불가','오류')`;
    // 알림 줄을 빨리 찾는다 — 통장 파일이 올라올 때마다 「알림|」 줄을 훑는다
    await sql`CREATE INDEX IF NOT EXISTS idx_cash_txn_alert ON cash_txn (account_label, occurred_at)
              WHERE is_active AND dedup_key LIKE '알림|%'`;
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM intake_log`;
    console.log(`✅ intake_log 준비 완료 (지금 ${n}건)`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
