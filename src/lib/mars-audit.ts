import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * ⭐ MARS 정합 감사 (사장님 승인 2026-08-10 — 자동입력 개선 전략).
 *
 * 자동입력의 실패는 이제 대부분 「MARS 쪽이 바뀌는 것」이라 완전히 막을 수 없다.
 * 대신 **어긋난 채로 조용히 남는 것**을 막는다 — 실행이 끝날 때마다 이 감사가
 * 「우리 기록과 MARS 진행 상태가 안 맞는 건」을 세어 정비 내역 맨 위에 띄운다.
 *
 * 전부 조회 전용이다. 여기 나온 것을 사람이 처리하는 길:
 *   전기 미확인   → MARS 에서 전기 (주문은 채워져 있다) 또는 --post-draft
 *   점검 미완     → 정비 내역의 「점검 실행」 단추
 *   보류·수동처리 → 카드 체크 → MARS 자동 올리기
 */

export interface MarsAuditRow {
  quoteId: number;
  quoteNo: string;
  plateNo: string | null;
  customerName: string | null;
  total: number;
  workDate: string | null;
  memo: string | null;
}

export interface MarsAudit {
  /** 전송완료인데 송장번호가 없다 — 주문은 들어갔는데 전기가 확인 안 된 것 */
  unposted: MarsAuditRow[];
  /** 전기까지 됐는데 차량 점검이 안 끝났다 */
  unchecked: MarsAuditRow[];
  /** 아직 MARS 에 안 올라간 성사 판매 (보류 + 수동처리) — 배너에는 수만 */
  pendingCount: number;
  /** 최근 입력 실행 20회의 성공/경고 요약 */
  recentRuns: { total: number; warned: number };
  /** 마지막 자가점검 결과 — 없으면 null */
  smoke: { at: string; ok: boolean; note: string } | null;
  /**
   * ⭐ 매장 PC 의 MARS 대리인이 켜져 있나 (2026-09-10 점검)
   * 한 번도 찍힌 적이 없으면 null — 아직 새 판번호를 안 받은 PC 다.
   */
  robot: { alive: boolean; at: string; host: string } | null;
  /** 처리를 눌러 놨는데 로봇이 안 받아 가는 요청이 있나 */
  waitingRun: boolean;
  /** 배너를 띄울 일이 있는가 */
  hasIssues: boolean;
}

export async function marsAudit(): Promise<MarsAudit> {
  const rowFields = sql`
    q.id, q.quote_no, v.plate_no, c.name customer_name, q.total_amount,
    to_char(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date), 'MM-DD') work_date,
    q.mars_memo
  `;
  type Raw = {
    id: number;
    quote_no: string;
    plate_no: string | null;
    customer_name: string | null;
    total_amount: number;
    work_date: string | null;
    mars_memo: string | null;
  };
  const toRow = (r: Raw): MarsAuditRow => ({
    quoteId: Number(r.id),
    quoteNo: r.quote_no,
    plateNo: r.plate_no,
    customerName: r.customer_name,
    total: Number(r.total_amount),
    workDate: r.work_date,
    memo: r.mars_memo,
  });

  /**
   * 🔴 질의는 하나씩 차례로 (2026-08-11 2차 마비) — Promise.all 로 동시에 쏘면
   *    트랜잭션 풀러에서 전송이 꼬여 ClientRead 좀비가 된다. 순차 5개 ≈ 0.1초다.
   */
  const unposted = await db.execute<Raw>(sql`
      SELECT ${rowFields}
      FROM quote q
      LEFT JOIN vehicle v ON v.id = q.vehicle_id
      LEFT JOIN customer c ON c.id = q.customer_id
      WHERE q.status = '성사' AND q.mars_status = '전송완료'
        /**
         * ⭐ '수동확인' 도 「번호 없음」과 같이 본다 (단계3-B, 2026-08-21).
         *    사람이 MARS 에서 직접 처리했다고 표시만 해 둔 것이라 **송장 번호가 없다** —
         *    진짜 올라갔는지 우리 기록만 봐서는 알 수 없으니 감사에 걸어 둔다.
         *    아침 대사가 번호를 찾아 채우면 여기서 저절로 빠진다.
         */
        AND (q.mars_ref_no IS NULL OR q.mars_ref_no = '수동확인')
        AND q.quote_no LIKE 'Q%'  -- 이관분(MARS-…)은 이미 MARS 에 있던 것 — 감사 대상 아님
      ORDER BY q.id DESC LIMIT 20
    `);
  const unchecked = await db.execute<Raw>(sql`
      SELECT ${rowFields}
      FROM quote q
      LEFT JOIN vehicle v ON v.id = q.vehicle_id
      LEFT JOIN customer c ON c.id = q.customer_id
      WHERE q.status = '성사' AND q.mars_status = '전송완료'
        -- '수동확인' 은 위 unposted 가 맡는다 — 한 건이 두 곳에 뜨지 않게
        AND q.mars_ref_no IS NOT NULL AND q.mars_ref_no <> '수동확인'
        AND q.vehicle_check_at IS NULL
        AND v.plate_no IS NOT NULL
        AND q.quote_no LIKE 'Q%'
      ORDER BY q.id DESC LIMIT 20
    `);
  const pending = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int n FROM quote
      WHERE status = '성사' AND mars_status IN ('보류', '수동처리')
        /* 예약중은 시공 전이라 「아직 안 올린 판매」가 아니다 (2026-09-01) */
        AND COALESCE(reservation_status, '') <> '예약중'
    `);
  const runs = await db.execute<{ warned: boolean }>(sql`
      SELECT (log LIKE '%⚠️%' OR status = '실패') warned
      FROM mars_run WHERE kind = '입력' ORDER BY id DESC LIMIT 20
    `);
  const smokeRows = await db.execute<{ at: string; log: string | null; status: string }>(sql`
      SELECT to_char(requested_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at, log, status
      FROM mars_run WHERE kind = '자가점검' ORDER BY id DESC LIMIT 1
    `);
  /* 매장 PC 두 대 중 **하나라도** 최근에 찍었으면 켜진 것 (blog-job.ts 와 같은 기준) */
  const beats = await db.execute<{ at: string; host: string; fresh: boolean }>(sql`
      SELECT to_char(last_seen AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at, host,
             (last_seen > now() - interval '10 minutes') fresh
      FROM agent_heartbeat WHERE name = 'mars'
      ORDER BY last_seen DESC LIMIT 2
    `);
  /* 눌러 놓은 요청이 로봇을 못 만나고 5분 넘게 서 있나 */
  const waiting = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int n FROM mars_run
      WHERE status = '대기' AND requested_at < now() - interval '5 minutes'
    `);

  const smoke = smokeRows[0]
    ? {
        at: smokeRows[0].at,
        ok: smokeRows[0].status === "완료" && !/⚠️|❌/.test(smokeRows[0].log ?? ""),
        note:
          (smokeRows[0].log ?? "")
            .split("\n")
            .filter((l) => /⚠️|❌|✅ 자가점검/.test(l))
            .slice(-3)
            .join(" · ")
            .trim() || (smokeRows[0].status === "완료" ? "통과" : smokeRows[0].status),
      }
    : null;

  const audit: MarsAudit = {
    unposted: unposted.map(toRow),
    unchecked: unchecked.map(toRow),
    pendingCount: Number(pending[0]?.n ?? 0),
    recentRuns: { total: runs.length, warned: runs.filter((r) => r.warned).length },
    smoke,
    robot: beats[0] ? { alive: beats.some((b) => b.fresh), at: beats[0].at, host: beats[0].host } : null,
    waitingRun: Number(waiting[0]?.n ?? 0) > 0,
    hasIssues: false,
  };
  // 보류는 「아직 안 올린 것」일 뿐 문제가 아니다 — 배너 기준은 어긋남·점검 누락·자가점검 실패
  /* ⭐ 보류도 경고에 넣는다 (2026-09-10 점검) — 전에는 「보류 = 오늘 아직 안 누른 것」
     이라 일부러 뺐지만, 지금은 보류가 **몇 달째 쌓이는 창고**가 됐다.
     실측: 8·9월 보류 177건 4,385만원, 그중 122건은 어떤 차단 규칙에도 안 걸리고
     그냥 아무도 안 눌렀다 — 정비 내역이 「오늘」만 보여 주기 때문. 분기 평가에서
     수천만원어치가 조용히 빠지므로 20건 넘게 쌓이면 알린다. */
  audit.hasIssues =
    audit.unposted.length > 0 ||
    audit.unchecked.length > 0 ||
    audit.pendingCount >= 20 ||
    audit.waitingRun ||
    (smoke !== null && !smoke.ok);
  return audit;
}
