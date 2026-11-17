/**
 * ⭐ 은행 입출금 폰 알림 → 통장 줄 (순수 함수 — DB 없음, 시험 대상) (2026-11-17)
 *
 *   사장님 폰(안드로이드)의 「신한 SOL Biz」 앱 알림을 알림 전달 앱이 /api/intake 로 보낸다.
 *   실물 (2026-11-17 캡처):
 *
 *     입출금 안내
 *     입금 1,660,680원 11/17 10:34
 *     입금(1210) ← 현240991175
 *     잔액 9,639,873원
 *
 *     입출금 안내                      ← 출금 (2026-11-17 12:55 캡처)
 *     출금 9,768,703원 11/17 12:55
 *     입금(1210) → (주)싸이오토모
 *     잔액 0원
 *
 *   🔴 둘째 줄 앞의 「입금(1210)」은 거래 종류가 아니라 **통장 별명 + 계좌 끝 네 자리**다 — 출금 알림에도
 *      「입금(1210)」이 붙는다(별명이 「입금」인 통장). 별명은 통장마다 다르니 별명이 아니라 숫자로 가른다.
 *   🔴 알림은 **속보**다. 통장 파일(정본)이 올라오면 같은 거래를 파일 내용으로 **확정**한다
 *      (matchAlertToStatement — 새 줄을 하나 더 만들지 않는다. fin-ingest.ingestCashTxns).
 *   🔴 접힌 알림은 둘째·셋째 줄이 잘려 올 수 있다 — 금액·시각만 있어도 받고, 잔액 없음은 표시한다.
 */

export interface BankAlert {
  direction: "입금" | "출금";
  amount: number;
  /** KST "YYYY-MM-DD HH:mm:00" — 알림은 분까지만 준다 */
  occurredAt: string;
  /** 「입금(1210)」의 괄호 숫자 = 계좌 끝 네 자리 — 계좌를 가르는 표 (BANK_ALERT_ACCOUNTS 로 계정 이름에 잇는다) */
  accountTag: string | null;
  /** 「입금(1210)」의 앞말 = SOL Biz 에 붙인 통장 별명 (거래 종류 아님). 화면 표시용 */
  accountName: string | null;
  /** 「← 현240991175」 상대(입금자·받는 분). 카드사 정산이면 카드사 첫 글자 + 가맹점 번호 */
  counterparty: string | null;
  /** 거래 후 잔액 — 통장 파일과 맞춰 볼 핵심 열쇠 */
  balance: number | null;
}

const num = (s: string) => Number(s.replace(/[^\d]/g, ""));

/**
 * 알림 글자 → 거래. 은행 알림이 아니면 null.
 * @param now 받은 시각 — 알림에 연도가 없어 연도를 여기서 정한다 (1월에 받은 12월 알림은 작년)
 */
export function parseBankAlert(text: string, now: Date = new Date()): BankAlert | null {
  const t = text.replace(/\r/g, "").replace(/[ \t ]+/g, " ");

  // 첫 줄: 「입금 1,660,680원 11/17 10:34」 — 시각이 잘린 「11/17」만 와도 받는다
  const head = /(입금|출금)\s*([\d,]+)\s*원\s*(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(t);
  if (!head) return null;
  const direction = head[1] as "입금" | "출금";
  const amount = num(head[2]);
  if (!(amount > 0)) return null;
  const mm = Number(head[3]);
  const dd = Number(head[4]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const hh = head[5] != null ? Number(head[5]) : 0;
  const mi = head[6] != null ? Number(head[6]) : 0;

  const kst = new Date(now.getTime() + 9 * 3_600_000);
  let year = kst.getUTCFullYear();
  if (mm > kst.getUTCMonth() + 2) year -= 1; // 1월에 받은 12월 거래
  const pad = (n: number) => String(n).padStart(2, "0");
  const occurredAt = `${year}-${pad(mm)}-${pad(dd)} ${pad(hh)}:${pad(mi)}:00`;

  // 둘째 줄: 「별명(끝4자리) ← 상대」(입금) / 「별명(끝4자리) → 상대」(출금)
  //   별명은 아무 말이나 될 수 있다(「입금」「주거래」…). 괄호 안이 숫자일 때만 계좌로 본다 — 상대의 「(주)」와 갈린다
  const who = /([^\s()←→<>]{1,20})\s*\((\d{3,6})\)\s*(?:←|→|<-|->|<|>)?\s*([^\n]+)/.exec(t.slice(head.index + head[0].length));
  const accountName = who?.[1] ?? null;
  const accountTag = who?.[2] ?? null;
  const counterpartyRaw = who?.[3]?.replace(/잔액.*$/, "").replace(/…|\.\.\.$/g, "").trim() ?? "";
  const counterparty = counterpartyRaw.length > 0 ? counterpartyRaw : null;

  const bal = /잔액\s*(-?[\d,]+)\s*원/.exec(t);
  const balance = bal ? (bal[1].startsWith("-") ? -num(bal[1]) : num(bal[1])) : null;

  return { direction, amount, occurredAt, accountTag, accountName, counterparty, balance };
}

/** 「1210=신한입금;5678=신한출금」 → 계좌표 → 계정 이름 */
export function parseAccountMap(s: string | undefined | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of (s ?? "").split(/[;,]/)) {
    const [k, v] = part.split("=").map((x) => x?.trim());
    if (k && v) m.set(k, v);
  }
  return m;
}

/** 통장 줄의 중복 방지 열쇠 — 알림 줄은 「알림|」로 시작해 파일 줄(「통장|」)과 갈린다 */
export function alertDedupKey(label: string, a: BankAlert): string {
  const inAmt = a.direction === "입금" ? a.amount : 0;
  const outAmt = a.direction === "출금" ? a.amount : 0;
  // 잔액이 있으면 잔액이 유일성을 준다(같은 분 같은 금액 두 번도 잔액이 다르다)
  return a.balance != null
    ? `알림|${label}|${inAmt}|${outAmt}|${a.balance}`
    : `알림|${label}|${a.occurredAt}|${inAmt}|${outAmt}`;
}

export const ALERT_KEY_PREFIX = "알림|";

/* ------------------------------------------------------------------ */
/* 통장 파일이 올라올 때 — 알림 줄과 파일 줄 짝짓기                     */

export interface CashLineLite {
  id: number;
  /** KST "YYYY-MM-DD HH:mm:ss" */
  occurredAt: string;
  inAmount: number;
  outAmount: number;
  balance: number | null;
}

const minutesBetween = (a: string, b: string) =>
  Math.abs(Date.parse(a.replace(" ", "T") + "+09:00") - Date.parse(b.replace(" ", "T") + "+09:00")) / 60_000;

/**
 * 통장 파일 줄 하나에 맞는 알림 줄을 고른다. 없거나 애매하면 null.
 *
 *   잔액까지 같으면 → 같은 거래 (시각은 하루 안이면 된다: 알림 지연·분 단위 절삭)
 *   잔액이 한쪽에 없으면 → 금액이 같고 5분 안이며 **후보가 하나뿐**일 때만
 *
 * 🔴 애매하면 짝짓지 않는다 — 그 경우 알림 줄과 파일 줄이 둘 다 남고,
 *    알림 줄은 대조 화면에서 「제외」로 접으면 된다. 틀리게 합치는 것보다 낫다.
 */
export function matchAlertToStatement(
  stmt: CashLineLite,
  alerts: readonly CashLineLite[],
  taken: ReadonlySet<number>,
): number | null {
  const same = alerts.filter(
    (a) => !taken.has(a.id) && a.inAmount === stmt.inAmount && a.outAmount === stmt.outAmount,
  );
  if (stmt.balance != null) {
    const byBal = same.filter((a) => a.balance === stmt.balance && minutesBetween(a.occurredAt, stmt.occurredAt) <= 24 * 60);
    if (byBal.length === 1) return byBal[0].id;
    if (byBal.length > 1) return null;
  }
  const near = same.filter((a) => (a.balance == null || stmt.balance == null) && minutesBetween(a.occurredAt, stmt.occurredAt) <= 5);
  return near.length === 1 ? near[0].id : null;
}
