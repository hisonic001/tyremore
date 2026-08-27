/**
 * 타이어 나이 — 「얼마나 묵었나」의 정본 (사장님 지시 2026-08-27)
 *
 *   "타이어 매입시 dot를 붙이면 가장 좋지만 못할때도 많으니
 *    매입한 날짜도 dot와 함께 붙여주었으면 좋겠음."
 *
 * 🔴 DOT 와 입고일은 **다른 값이다.**
 *   · DOT      = 타이어를 **만든** 때 (제조주차). 고객에게 말하는 값이고 노후 판단의 근거다.
 *   · 입고일   = 우리가 **받은** 때. 오늘 받은 타이어가 2년 전에 만들어졌을 수 있으므로
 *                입고일은 제조일을 대신하지 못한다. **"적어도 이 날 이전에 만들어졌다"는
 *                상한선**일 뿐이다.
 * 그래서 화면에는 두 값을 **나란히, 이름을 달리해서** 보여준다. 한 칸에 섞으면
 * 매입일을 제조년으로 말하게 되고, 그건 고객 앞에서 곤란해진다.
 *
 * 🔴 대신 **줄 세울 때는 한 축이어야 한다.** DOT 있으면 제조 추정일, 없으면 입고일 —
 *    그게 `ageAnchor` 다. 선입선출·묵은 재고 경고·화면 정렬이 모두 이 한 함수를 쓴다.
 *
 * ── 이 파일이 생긴 이유가 된 버그 (2026-08-27 확인) ─────────────────────
 * DOT 는 `WWYY`(주차+연도)라 **글자 순서가 시간 순서가 아니다.**
 *   `0926`(26년 9주) 와 `4825`(25년 48주) 를 글자로 세우면 `0926` 이 먼저지만,
 *   실제로 오래된 것은 `4825` 다.
 * 판매할 때 재고를 고르는 순서가 글자순이었던 탓에 **25년산을 두고 26년산이 먼저
 * 나가고 있었다** (#77 · #1536 · #2076 세 품목에서 실제로 뒤집혀 있었다).
 * 게다가 `NULLS FIRST` 라 DOT 를 모르는 새 물건이 DOT 찍힌 24년산보다 먼저 나갔다.
 */

/* ------------------------------------------------------------------
 * DOT 읽기
 * ---------------------------------------------------------------- */

/** 얼마나 오래된 DOT 까지 믿을 것인가 — `normalize.ts` 의 `isPlausibleDot` 과 같은 기준 */
const MAX_AGE_YEARS = 15;

/**
 * `WWYY` → 제조 추정일. `1826` = 2026년 18주차 ≈ 2026-04-30
 *
 * 주차의 정확한 첫날까지 따지지 않는다 — 줄 세우기와 「몇 년 됐나」에만 쓰므로
 * 그 해 1월 1일 + (주차-1)×7 로 충분하다. 며칠 차이는 어느 판단도 뒤집지 못한다.
 *
 * 말이 안 되는 값(`1882` → 2082년산)은 **null 로 돌린다.** 실데이터에 있었던 오타이고,
 * 그대로 믿으면 「가장 새것」이 되어 영영 안 팔린다.
 */
export function dotToDate(dot: string | null | undefined, now = new Date()): Date | null {
  const s = String(dot ?? "").trim();
  if (!/^[0-9]{4}$/.test(s)) return null;
  const week = Number(s.slice(0, 2));
  if (week < 1 || week > 53) return null;
  const year = 2000 + Number(s.slice(2, 4));
  if (year < now.getFullYear() - MAX_AGE_YEARS || year > now.getFullYear() + 1) return null;
  const d = new Date(Date.UTC(year, 0, 1));
  d.setUTCDate(d.getUTCDate() + (week - 1) * 7);
  return d;
}

/** `WWYY` → 제조 연도 4자리. 못 믿을 값이면 null */
export function dotYear(dot: string | null | undefined, now = new Date()): number | null {
  const d = dotToDate(dot, now);
  return d === null ? null : d.getUTCFullYear();
}

/** `1826` → `26년 18주` — 사장님이 읽는 말 */
export function dotLabel(dot: string): string {
  if (!/^[0-9]{4}$/.test(dot)) return dot;
  return `${dot.slice(2, 4)}년 ${Number(dot.slice(0, 2))}주`;
}

/* ------------------------------------------------------------------
 * 한 축 — 줄 세우기의 기준
 * ---------------------------------------------------------------- */

export interface AgeAnchor {
  /** 이 타이어를 언제 것으로 볼 것인가 */
  at: Date;
  /** 그 날짜가 어디서 왔나 — 「제조」면 DOT, 「입고」면 받은 날 */
  from: "제조" | "입고";
}

/**
 * 오래된 것부터 나가게 하는 한 축.
 * DOT 를 알면 제조 추정일, 모르면 입고일. **모르는 것을 새것으로 치지 않는다.**
 */
export function ageAnchor(
  dot: string | null | undefined,
  receivedAt: Date | string | null | undefined,
  now = new Date(),
): AgeAnchor {
  const made = dotToDate(dot, now);
  if (made) return { at: made, from: "제조" };
  const r = receivedAt ? new Date(receivedAt) : null;
  return { at: r && !Number.isNaN(r.getTime()) ? r : now, from: "입고" };
}

/**
 * SQL 쪽 같은 식. 화면과 서버가 서로 다른 순서를 내면 사장님이 앱을 못 믿게 된다.
 *
 * 부르는 쪽이 컬럼 이름을 그대로 넘긴다 — `ageAnchorSql("s.dot", "s.received_at")`.
 * drizzle 의 `sql` 템플릿 안에 `sql.raw()` 로 끼워 넣거나 문자열로 이어 붙여 쓴다.
 */
export function ageAnchorSql(dotCol: string, receivedCol: string): string {
  return `COALESCE(
    CASE WHEN ${dotCol} ~ '^[0-9]{4}$'
          AND substr(${dotCol},1,2)::int BETWEEN 1 AND 53
          AND (2000 + substr(${dotCol},3,2)::int)
              BETWEEN date_part('year', now())::int - ${MAX_AGE_YEARS}
                  AND date_part('year', now())::int + 1
         THEN make_date(2000 + substr(${dotCol},3,2)::int, 1, 1)
              + ((substr(${dotCol},1,2)::int - 1) * 7)
    END,
    (${receivedCol} AT TIME ZONE 'Asia/Seoul')::date
  )`;
}

/** 「제조 2년 넘은 것」을 세는 조건 — `/stock` 요약과 경고 배지가 같은 기준을 쓴다 */
export function oldByDotSql(dotCol: string): string {
  return `(${dotCol} ~ '^[0-9]{4}$'
           AND (2000 + substr(${dotCol},3,2)::int) <= date_part('year', now())::int - ${WARN_MADE_YEARS})`;
}

/** 「DOT 모르는 채로 1년 넘게 있는 것」을 세는 조건 */
export function staleNoDotSql(dotCol: string, receivedCol: string): string {
  return `(${dotCol} IS NULL AND ${receivedCol} < now() - interval '${WARN_HELD_MONTHS} months')`;
}

/* ------------------------------------------------------------------
 * 묵은 재고 경고
 * ---------------------------------------------------------------- */

/** 제조 몇 년부터 알릴 것인가 — `/stock` 요약의 「2년 넘은 것」과 같은 값이다 */
const WARN_MADE_YEARS = 2;
/** 그 위로 몇 년이면 빨간불인가 */
const BAD_MADE_YEARS = 4;
/** DOT 를 모를 때, 받아둔 지 몇 달부터 알릴 것인가 */
const WARN_HELD_MONTHS = 12;
/** 그 위로 몇 달이면 빨간불인가 */
const BAD_HELD_MONTHS = 24;

export interface AgeBadge {
  /** 배지에 찍히는 말 — `제조 3년` / `입고 1년 6개월` */
  text: string;
  /** `warn` 노란불 · `bad` 빨간불 */
  tone: "warn" | "bad";
  /** 눌렀을 때/마우스 올렸을 때 나오는 설명 */
  title: string;
}

/** 두 날짜 사이 개월 수 (내림) */
function monthsBetween(from: Date, to: Date): number {
  let m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) m -= 1;
  return Math.max(0, m);
}

/** `18` → `1년 6개월`, `12` → `1년`, `7` → `7개월` */
function monthsLabel(m: number): string {
  const y = Math.floor(m / 12);
  const rest = m % 12;
  if (y === 0) return `${rest}개월`;
  return rest === 0 ? `${y}년` : `${y}년 ${rest}개월`;
}

/**
 * 이 재고가 묵었는지 알린다. 멀쩡하면 null — **평소엔 아무것도 안 보이는 게 맞다.**
 *
 * DOT 를 아는 것과 모르는 것에 **다른 말을 쓴다.** 모르는 것을 「제조 N년」이라 하면
 * 거짓말이 된다 — 우리가 아는 건 받아둔 지 얼마나 됐나뿐이다.
 */
export function ageBadge(
  dot: string | null | undefined,
  receivedAt: Date | string | null | undefined,
  now = new Date(),
): AgeBadge | null {
  const made = dotToDate(dot, now);
  if (made) {
    const m = monthsBetween(made, now);
    const years = Math.floor(m / 12);
    if (years < WARN_MADE_YEARS) return null;
    return {
      text: `제조 ${monthsLabel(m)}`,
      tone: years >= BAD_MADE_YEARS ? "bad" : "warn",
      title: `DOT ${String(dot)} — ${made.getUTCFullYear()}년산입니다. 오래된 것부터 내보내세요.`,
    };
  }

  const r = receivedAt ? new Date(receivedAt) : null;
  if (!r || Number.isNaN(r.getTime())) return null;
  const m = monthsBetween(r, now);
  if (m < WARN_HELD_MONTHS) return null;
  return {
    text: `입고 ${monthsLabel(m)}`,
    tone: m >= BAD_HELD_MONTHS ? "bad" : "warn",
    title:
      `받아둔 지 ${monthsLabel(m)} 됐습니다. DOT 를 모르니 제조 연도는 알 수 없고, ` +
      `**적어도** 입고일 이전에 만들어진 물건입니다.`,
  };
}

/* ------------------------------------------------------------------
 * 화면 표기
 * ---------------------------------------------------------------- */

/** 서울 시각 기준 `YYYY-MM-DD` */
export function ymdKst(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(dt);
}

/** `8/12` — 해가 다르면 `25/12/3` 까지 붙인다 */
export function shortDate(d: Date | string | null | undefined, now = new Date()): string {
  if (!d) return "";
  const ymd = ymdKst(d);
  const [y, m, day] = ymd.split("-");
  const thisYear = ymdKst(now).slice(0, 4);
  return y === thisYear ? `${Number(m)}/${Number(day)}` : `${y.slice(2)}/${Number(m)}/${Number(day)}`;
}

/**
 * 입고일 한 줄 — `8/12 입고` · 여러 날에 걸쳐 들어왔으면 `8/12~8/20 입고`
 */
export function receivedLabel(
  first: Date | string | null | undefined,
  last: Date | string | null | undefined,
  now = new Date(),
): string {
  if (!first) return "";
  const a = shortDate(first, now);
  const b = last ? shortDate(last, now) : a;
  return a === b ? `${a} 입고` : `${a}~${b} 입고`;
}
