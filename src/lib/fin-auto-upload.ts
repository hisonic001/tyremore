/**
 * ⭐ 회계 파일 폴더 자동 업로드 — PC 수집기(scripts/collect.ts)가 부른다 (2026-11-17, D-41)
 *
 *   사장님이 홈택스·여신협회·카드사·은행에서 내려받은 파일을 「회계\올리기」 폴더에 넣으면
 *   화면 「자료 → 올리기」와 **같은 정본**(fin-sheet.parseAnyFin → fin-ingest.*)으로 반영하고,
 *   화면처럼 올린 직후 자동 대조(auto-recon-run)까지 돈다.
 *
 *   화면과 다른 점 — 사람이 미리보기를 안 보므로 **더 보수적**이다:
 *     · 통장·법인카드의 계정 이름은 파일 이름으로 고른다(fin-upload-pure.pickAccountLabel). 모르면 올리지 않는다.
 *     · 우리카드 두 형식 겹침(같은 지출 이중 계상)이면 올리지 않는다 — 화면은 경고만 하지만 여기선 볼 사람이 없다.
 *     · 못 읽은 줄이 있으면 올리되 결과 한 줄에 적는다(화면의 미리보기 경고와 같은 정보).
 *   되돌리기는 화면과 같다 — 「최근 한 일」·「최근 올린 자료」에서 배치 취소.
 *
 * 🔴 "use server" 아님. 질의는 순차(커넥션 max 3).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getShopInfo } from "./shop";
import { parseAnyFin } from "./fin-sheet";
import { ingestCardDays, ingestCardDeposits, ingestCardTxns, ingestCashTxns, ingestPosTxns, ingestTaxInvoices, type IngestResult } from "./fin-ingest";
import { extractFirst, isOfficeZip, isZip } from "./zip-crypto";
import { pickAccountLabel, ymsOfRows } from "./fin-upload-pure";
import { parseAccountMap } from "./bank-alert-pure";
import { logActivity } from "./fin-activity";
import { runAutoRecon } from "./auto-recon-run";

export type FinAutoResult = { ok: true; line: string } | { ok: false; error: string; notFinance?: boolean };

export async function finAutoUpload(fileName: string, raw: Buffer): Promise<FinAutoResult> {
  let buf = raw;
  let name = fileName;
  if (/\.zip$/i.test(name) || (isZip(raw) && !isOfficeZip(raw))) {
    try {
      const entry = extractFirst(raw, process.env.POS_ZIP_PASSWORD ?? null, (n) => /\.xlsx?$/i.test(n));
      if (!entry) return { ok: false, error: "zip 안에 엑셀 파일이 없습니다" };
      buf = entry.data;
      name = entry.name;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const shop = await getShopInfo();
  let p: ReturnType<typeof parseAnyFin>;
  try {
    p = parseAnyFin(buf, shop.bizNo, name);
  } catch (e) {
    return { ok: false, notFinance: true, error: `회계 자료로 알아보지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (p.rows.length === 0) return { ok: false, notFinance: true, error: "읽을 수 있는 줄이 없습니다" };

  const dates =
    p.kind === "tax"
      ? p.rows.map((r) => r.writeDate)
      : p.kind === "cardday"
        ? p.rows.map((r) => r.date)
        : p.kind === "carddeposit"
          ? p.rows.map((r) => r.month)
          : p.kind === "cardtxn"
            ? p.rows.map((r) => r.approvedAt)
            : p.kind === "postxn"
              ? p.rows.map((r) => r.day)
              : p.rows.map((r) => r.occurredAt);
  const { best: ym, yms } = ymsOfRows(dates, p.periodTo ?? p.periodFrom);
  const label = `자동: ${fileName}`;

  let r: IngestResult;
  let account: string | null = null;
  if (p.kind === "tax") r = await ingestTaxInvoices(p, null, label);
  else if (p.kind === "postxn") r = await ingestPosTxns(p, null, label);
  else if (p.kind === "cardtxn") r = await ingestCardTxns(p, null, label);
  else if (p.kind === "cardday") r = await ingestCardDays(p, null, label);
  else if (p.kind === "carddeposit") r = await ingestCardDeposits(p, null, label);
  else {
    const labels = await db.execute<{ l: string }>(sql`
      SELECT DISTINCT account_label l FROM cash_txn WHERE source = ${p.source} AND account_label IS NOT NULL LIMIT 50
    `);
    account = pickAccountLabel(fileName, labels.map((x) => x.l), parseAccountMap(process.env.COLLECT_FIN_LABELS));
    if (!account) {
      return {
        ok: false,
        error:
          `${p.formatName} — 어느 ${p.source === "통장" ? "통장" : "카드"}인지 파일 이름으로 알 수 없습니다. ` +
          `파일 이름에 계정 이름(${labels.map((x) => x.l).join(" · ") || "예: 신한입금"})을 넣어 다시 두시거나 화면에서 올려 주세요`,
      };
    }
    const overlap = await wooriOverlap(p.formatName, p.periodFrom, p.periodTo);
    if (overlap) return { ok: false, error: `${p.formatName} — ${overlap} 화면에서 확인 후 올려 주세요` };
    r = await ingestCashTxns(p, account, null, label);
  }

  await logActivity({
    ym,
    actor: null,
    how: "자동",
    verb: "올리기",
    target: { table: "fin_upload", id: r.uploadId },
    n: Math.max(1, r.newCount),
    label: `자동 올리기(회계 폴더): ${p.formatName} ${fileName} — 새 줄 ${r.newCount}${r.dupCount > 0 ? ` · 이미 있던 줄 ${r.dupCount}` : ""}`,
    undo: { kind: "upload", args: { uploadId: r.uploadId } },
  });

  const auto = await runAutoRecon(p.source, yms, null);
  const c = auto.counts;
  const autoLine = [c.deposits && `입금 ${c.deposits}`, c.withdrawals && `지급 ${c.withdrawals}`, c.tax && `계산서 ${c.tax}`, c.cardSettle && `카드정산 ${c.cardSettle}`]
    .filter(Boolean)
    .join(" · ");
  const bad = p.skipped.filter((s) => !s.expected).length;
  return {
    ok: true,
    line:
      `${p.formatName}${account ? ` [${account}]` : ""} — 새 줄 ${r.newCount}` +
      (r.dupCount ? ` · 이미 있던 줄 ${r.dupCount}` : "") +
      (r.confirmedAlerts ? ` · 폰 알림 확정 ${r.confirmedAlerts}` : "") +
      (autoLine ? ` · 자동 대조 ${autoLine}` : "") +
      (bad ? ` · ⚠️ 못 읽은 줄 ${bad}개(화면에서 확인)` : "") +
      (auto.errors.length ? ` · ⚠️ 자동 대조 오류 ${auto.errors.length}` : ""),
  };
}

/** fin-upload.wooriOverlapWarning 과 같은 판정 — 저쪽은 서버 액션 파일 안이라 내보낼 수 없어 같은 질의를 둔다 */
async function wooriOverlap(formatName: string, from: string | null, to: string | null): Promise<string | null> {
  if (!from || !to) return null;
  const other =
    formatName === "우리카드 승인 상세내역" ? "이용대금 상세내역" : formatName.startsWith("우리카드 이용대금") ? "승인 상세내역" : null;
  if (!other) return null;
  const rows = await db.execute<{ file_name: string }>(sql`
    SELECT file_name FROM fin_upload
    WHERE status = '반영' AND source = '법인카드'
      AND period_from IS NOT NULL AND period_to IS NOT NULL
      AND period_from <= ${to}::date AND period_to >= ${from}::date
      AND raw_text LIKE ${"%" + other + "%"}
    ORDER BY id DESC LIMIT 3
  `);
  return rows.length === 0
    ? null
    : `같은 기간을 이미 우리카드 「${other}」(${rows.map((x) => x.file_name).join(" · ")})로 올려 두셔서 같은 지출이 두 번 잡힙니다.`;
}
