/**
 * ⭐ 월정산 거래처 기준일·시작 잔액 (계산서 화면 개편 결정 7·7-1, 2026-09-11)
 *
 *   사장님: "실제로 제대로 앱을 운영한 건 8~9월, 과거 자료가 발목" — 미쉐린 「남은 돈」 6,239만은
 *   2025-01 부터 누적한 과거 오차였다. 그래서 **기준일 2026-08-25**, **시작 잔액 = 세무사 원장
 *   (2026-01-01~08-24) 잔액**(사장님 8/26 「일치」 회신, 4라운드 확정)으로 끊고 그 뒤만 더하고 뺀다.
 *
 *   ① tax_party_rule 에 baseline_date(기본 2026-08-25) · baseline_amount(기본 0) · baseline_note 칸
 *   ② kind CHECK 에 '월정산' 정식 포함 (add-monthly-party.ts 가 이미 넣었으면 건너뜀)
 *   ③ 씨앗 — 결정 7-1 표 (8/24 기준). biz_no 는 tax_party_rule 기존 행을 이름으로 찾아 UPDATE.
 *      🔴 note 가 이미 있으면 안 덮는다 — 사장님이 「시작 잔액 고치기」로 고친 값을 지키려고(멱등).
 *
 *   출처 표기: '세무사 원장 2026-08-24' / '앱 추정'
 *     미쉐린 36,173,936 · 스칼릿 5,281,980 · 금호 2,997,316 · 콘티넨탈 1,413,026 · 프로디테일 45,160
 *     딜러타이어 0 (외상 510,200 ↔ 페이머니 선급 527,200 상계, 선급 17,000 표시)
 *     강남세차장 14,322,000 (앱 추정 — 2025 균형, 올해 계산서 3,083만 − 지급 1,651만 = 8/24 계산서 미지급과 일치)
 *     위즈오토 0 (앱 추정 — 지급이 계산서보다 많아 선급 가능성) · 쌍성트레이딩 0 · 맥스런 0
 *     미쉐린 「1,982,000 차이」는 로열티 자동이체 6회(330,300×6)로 확인 — 잔액 그대로.
 *
 *   실행: npx tsx --env-file=.env.local scripts/add-tax-baseline.ts   (멱등 — 사장님이 직접)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

const LEDGER = "세무사 원장 2026-08-24";
const APP = "앱 추정";

const SEEDS: { name: string; amount: number; note: string }[] = [
  { name: "미쉐린", amount: 36_173_936, note: LEDGER },
  { name: "스칼릿", amount: 5_281_980, note: LEDGER },
  { name: "금호", amount: 2_997_316, note: LEDGER },
  { name: "콘티넨탈", amount: 1_413_026, note: LEDGER },
  { name: "프로디테일", amount: 45_160, note: LEDGER },
  { name: "딜러타이어", amount: 0, note: `${LEDGER} — 페이머니 선급 17,000 (외상 510,200 과 선급 527,200 상계)` },
  { name: "강남세차장", amount: 14_322_000, note: `${APP} — 8/24 계산서 미지급 (2025 균형, 계산서 3,083만 − 지급 1,651만)` },
  { name: "위즈오토", amount: 0, note: `${APP} — 지급이 계산서보다 많음, 선급 가능` },
  { name: "쌍성", amount: 0, note: APP },
  { name: "맥스런", amount: 0, note: APP },
];

const squash = (s: string) => s.replace(/㈜|\(주\)|주식회사|\s/g, "");

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    // ① 칸
    await sql`ALTER TABLE tax_party_rule ADD COLUMN IF NOT EXISTS baseline_date date NOT NULL DEFAULT '2026-08-25'`;
    await sql`ALTER TABLE tax_party_rule ADD COLUMN IF NOT EXISTS baseline_amount integer NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE tax_party_rule ADD COLUMN IF NOT EXISTS baseline_note text`;
    console.log("✅ baseline_date · baseline_amount · baseline_note 칸 준비됨");

    // ② CHECK — 지금 정의에 '월정산' 이 없을 때만 다시 건다
    const [chk] = await sql<{ def: string | null }[]>`
      SELECT pg_get_constraintdef(oid) def FROM pg_constraint
      WHERE conrelid = 'tax_party_rule'::regclass AND conname = 'tax_party_rule_kind_check'`;
    if (chk?.def && chk.def.includes("월정산")) {
      console.log("· kind CHECK 에 '월정산' 이미 있음 — 건너뜀");
    } else {
      await sql`ALTER TABLE tax_party_rule DROP CONSTRAINT IF EXISTS tax_party_rule_kind_check`;
      await sql`ALTER TABLE tax_party_rule ADD CONSTRAINT tax_party_rule_kind_check
                CHECK (kind IN ('경비', '대행정산', '무시', '월정산'))`;
      console.log("✅ kind CHECK 에 '월정산' 추가됨");
    }

    // ③ 씨앗
    for (const s of SEEDS) {
      const cands = await sql<{ biz_no: string; name_raw: string; kind: string; baseline_note: string | null }[]>`
        SELECT biz_no, name_raw, kind, baseline_note FROM tax_party_rule
        WHERE replace(replace(replace(replace(name_raw, ' ', ''), '주식회사', ''), '(주)', ''), '㈜', '')
              ILIKE ${"%" + squash(s.name) + "%"}
        ORDER BY (kind = '월정산') DESC, id LIMIT 3`;
      if (cands.length === 0) {
        console.log(`- ${s.name}: tax_party_rule 에 없음 (건너뜀 — 먼저 「월정산」으로 지정)`);
        continue;
      }
      if (cands.length > 1) console.log(`  ⚠ ${s.name}: 규칙 ${cands.length}개 — 첫 것만`, cands.map((c) => `${c.name_raw}(${c.biz_no}·${c.kind})`).join(", "));
      const c = cands[0];
      if (c.kind !== "월정산") console.log(`  ⚠ ${c.name_raw}: 유형이 ${c.kind} — 잔액은 넣되 월정산 줄엔 안 쓰인다`);
      if (c.baseline_note) {
        console.log(`- ${c.name_raw} (${c.biz_no}): 이미 시작 잔액 있음 (${c.baseline_note}) — 그대로 둠`);
        continue;
      }
      await sql`
        UPDATE tax_party_rule
        SET baseline_date = '2026-08-25', baseline_amount = ${s.amount}, baseline_note = ${s.note}, updated_at = now()
        WHERE biz_no = ${c.biz_no}`;
      console.log(`- ${c.name_raw} (${c.biz_no}): 시작 잔액 ${s.amount.toLocaleString()} ✓  [${s.note}]`);
    }
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
