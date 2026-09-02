/**
 * 작업 후기 폼 — 「AI 가 쓴 티」의 근본을 푸는 재료 (B단계, 2026-09-02)
 *
 * 사장님 평가: "자연스러움이 없으며 ai가 작성한 티가 남."
 * 원인은 문체가 아니라 **사건이 없다**는 것이었다. 재료가 「차종·규격·본수」뿐이면
 * 모델은 일반론으로 문단을 채울 수밖에 없다.
 *
 *   사장님 글: "첫 방문 당시 이전 타이어에서 전륜 안쪽 편마모가 발견됐습니다."
 *   재료 없을 때: "타이어는 온도에 민감합니다. 여름 내내 뜨거운 노면을 달리면…"
 *
 * 그래서 본사 「작업 후기 제출 양식」 1~8번 중 **사장님만 아는 세 가지**(4·5·7)를 받는다.
 * 단 빈 칸 세 개를 내밀면 기름 묻은 손으로 못 채우신다 —
 * 🔴 **누르는 것(칩)만으로 채워지고, 숫자는 넣으면 좋고 안 넣어도 되는** 모양으로 만든다.
 *
 * 실제 발행 글의 신뢰는 문장이 아니라 **수치**에서 나온다:
 *   "토우와 캠버 값이 모두 기준치를 벗어나", "0.1mm 단위까지", "175Nm", "42psi"
 *
 * 🔴 `@/db` 를 import 하지 않는다 — 화면(클라이언트)과 테스트가 같이 쓴다.
 */

/** 4번 「차량 입고 이유 및 고객 방문 목적」 */
export const REASONS = [
  "주행 중 소음·떨림",
  "펑크",
  "마모가 심함",
  "정기 교체",
  "경고등 켜짐",
  "시동 불량",
  "여행 중 방문",
  "장거리 앞두고",
  "공기압 자주 빠짐",
  "다른 곳에서 권유받고",
] as const;

/** 5번 「실제 점검 결과 및 현 차량 상태」 */
export const FINDINGS = [
  "안쪽 편마모",
  "바깥쪽 편마모",
  "한쪽만 심하게 닳음",
  "트레드 마모 한계",
  "사이드월 손상·부풀음",
  "못 박힘",
  "제조 연식 오래됨",
  "휠 손상",
  "얼라인먼트 틀어짐",
  "배터리 노후",
  "이상 없음(예방 교체)",
] as const;

/** 7번 「해당 서비스 제공 이유」 */
export const WHYS = [
  "순정과 같은 사양",
  "장거리·고속 주행이 많음",
  "정숙성 중시",
  "연비 중시",
  "가격 대비 성능",
  "재고가 바로 있어서",
  "손님이 지정",
  "이전 타이어와 같은 제품",
  "겨울 대비",
] as const;

export type Reason = (typeof REASONS)[number];
export type Finding = (typeof FINDINGS)[number];
export type Why = (typeof WHYS)[number];

/**
 * 사장님이 채우는 것 전부. 전부 선택이지만, **셋 중 하나도 안 고르면 원고를 안 만든다**
 * (재료 없이 만들면 예전처럼 일반론 글이 나온다).
 */
export interface BlogForm {
  /** 4번 — 왜 오셨나 */
  reasons: string[];
  reasonNote?: string;
  /** 5번 — 뭘 봤나 */
  findings: string[];
  findingNote?: string;
  /** 7번 — 왜 이걸 권했나 */
  whys: string[];
  whyNote?: string;
  /** 수치 — 넣으면 글이 눈에 띄게 좋아진다 */
  treadMm?: string;
  torqueNm?: string;
  psi?: string;
  balanceG?: string;
  alignNote?: string;
  batteryCca?: string;
  /** 8번 — 블로그에 꼭 넣어 달라는 말 */
  extra?: string;
}

export const EMPTY_FORM: BlogForm = { reasons: [], findings: [], whys: [] };

/** 재료가 있는가 — 화면의 「원고 만들기」 버튼이 이걸 본다 */
export function formHasMaterial(f: BlogForm): boolean {
  return (
    f.reasons.length > 0 ||
    f.findings.length > 0 ||
    f.whys.length > 0 ||
    !!f.reasonNote?.trim() ||
    !!f.findingNote?.trim()
  );
}

/** 숫자만 남기고 단위를 붙인다 — 사장님이 "175" 만 쳐도 "175Nm" 이 된다 */
function num(v: string | undefined, unit: string): string | null {
  const s = (v ?? "").replace(/[^\d.]/g, "").trim();
  if (!s || Number(s) === 0) return null;
  return `${s}${unit}`;
}

/**
 * 폼을 지시문에 넣을 문장으로. **사람이 읽어도 개인정보가 없어야 한다**
 * (화면의 「이대로 만들까요?」 미리보기가 이걸 그대로 보여준다).
 */
export function formText(f: BlogForm): string {
  const lines: string[] = [];

  const reason = [f.reasons.join(", "), f.reasonNote?.trim()].filter(Boolean).join(" / ");
  if (reason) lines.push(`왜 오셨나: ${reason}`);

  const finding = [f.findings.join(", "), f.findingNote?.trim()].filter(Boolean).join(" / ");
  if (finding) lines.push(`점검해 보니: ${finding}`);

  const why = [f.whys.join(", "), f.whyNote?.trim()].filter(Boolean).join(" / ");
  if (why) lines.push(`이 제품을 권한 이유: ${why}`);

  const measures = [
    num(f.treadMm, "mm") ? `남은 홈 ${num(f.treadMm, "mm")}` : null,
    num(f.torqueNm, "Nm") ? `휠 너트 조임 ${num(f.torqueNm, "Nm")}` : null,
    num(f.psi, "psi") ? `공기압 ${num(f.psi, "psi")}` : null,
    num(f.balanceG, "g") ? `휠 밸런스 웨이트 ${num(f.balanceG, "g")}` : null,
    num(f.batteryCca, "CCA") ? `배터리 ${num(f.batteryCca, "CCA")}` : null,
    f.alignNote?.trim() ? `얼라인먼트: ${f.alignNote.trim()}` : null,
  ].filter(Boolean);
  if (measures.length) lines.push(`측정한 값: ${measures.join(", ")}`);

  if (f.extra?.trim()) lines.push(`블로그에 꼭 넣을 것: ${f.extra.trim()}`);

  return lines.join("\n");
}

/** 화면에서 온 값이 우리가 아는 것인지 — 목록에 없는 값은 버린다 */
export function sanitizeForm(raw: unknown): BlogForm {
  const o = (raw ?? {}) as Record<string, unknown>;
  const pick = (v: unknown, allow: readonly string[]) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && allow.includes(x)) : [];
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
  return {
    reasons: pick(o.reasons, REASONS),
    findings: pick(o.findings, FINDINGS),
    whys: pick(o.whys, WHYS),
    reasonNote: str(o.reasonNote, 300),
    findingNote: str(o.findingNote, 400),
    whyNote: str(o.whyNote, 300),
    treadMm: str(o.treadMm, 10),
    torqueNm: str(o.torqueNm, 10),
    psi: str(o.psi, 10),
    balanceG: str(o.balanceG, 20),
    alignNote: str(o.alignNote, 200),
    batteryCca: str(o.batteryCca, 10),
    extra: str(o.extra, 400),
  };
}
