/**
 * 블로그 초안 — DB·API 없는 순수 함수 (마케팅 1단계, 2026-08-29)
 *
 * 화면(클라이언트)과 테스트가 가져다 쓴다. 여기에는 `@/db` 를 절대 import 하지 않는다 —
 * 클라이언트 번들에 DB 접속이 딸려 들어간다.
 */

export const OWNER_SLOT = "{{사장님_한마디}}";

export interface DraftFacts {
  quoteId: number;
  quoteNo: string;
  maker: string | null;
  model: string | null;
  year: number | null;
  /**
   * ⭐ 주행거리 — **정확한 km 를 그대로 쓴다** (2026-09-02).
   *
   * 전에는 "8만km대"로 뭉갰는데, 사장님이 실제로 발행하신 글은 "126,726km"처럼
   * 정확히 쓰신다. 뭉갠 숫자는 아무 말도 안 한 것과 같아 「AI 가 쓴 티」의 큰 축이었다.
   * 번호판·이름이 안 나가는 한 이 숫자만으로 손님을 특정할 수 없다.
   */
  mileage: number | null;
  /** 쓰지 않는다 — 옛 초안 호환용으로만 남긴다 */
  mileageBand: string | null;
  tires: { name: string; spec: string | null; qty: number }[];
  services: string[];
  /** "8월 말, 한여름" — 정확한 날짜는 안 쓴다 */
  season: string;
  /** 🔴 출력에서 걸러야 할 글자(손님 이름 등). 지시문에는 절대 안 넣는다 */
  redact: string[];
}

export function mileageBand(km: number | null): string | null {
  if (!km || km <= 0) return null;
  if (km < 10_000) return "1만km 미만";
  return `${Math.floor(km / 10_000)}만km대`;
}

export function seasonPhrase(isoDate: string): string {
  const m = Number(isoDate.slice(5, 7));
  const d = Number(isoDate.slice(8, 10));
  const part = d <= 10 ? "초" : d <= 20 ? "중순" : "말";
  const feel =
    m <= 2 ? "한겨울" : m === 3 ? "겨울 끝, 환절기" : m <= 5 ? "봄" : m === 6 ? "장마 앞" : m <= 8 ? "한여름" : m === 9 ? "여름 끝물" : m <= 11 ? "가을, 겨울 준비" : "초겨울";
  return `${m}월 ${part}, ${feel}`;
}

/** 지시문에 넣는 사실 — 사람이 읽어도 개인정보가 없어야 한다 (--dry 가 이걸 보여준다) */
export function factsText(f: DraftFacts): string {
  const car = [f.maker, f.model, f.year ? `${f.year}년식` : null].filter(Boolean).join(" ") || "차종 미상";
  const tires = f.tires.map((t) => `${t.name}${t.spec ? ` ${t.spec}` : ""} ${t.qty}본`).join(", ");
  return [
    `차량: ${car}${f.mileage ? `, 주행거리 ${f.mileage.toLocaleString("ko-KR")}km` : ""}`,
    `시공: ${tires}`,
    f.services.length ? `함께 한 작업: ${f.services.join(", ")}` : null,
    `시기: ${f.season}`,
    `매장: 타이어모어 속초점 (미쉐린 가맹, 강원 속초)`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function duplicateWarn(f: DraftFacts, titles: string[]): string | null {
  const model = (f.model ?? "").trim();
  if (model.length < 2) return null;
  const hit = titles.find((t) => t.includes(model));
  return hit ? `최근 같은 차종 글이 있습니다 — 「${hit}」. 각도를 바꾸거나 이번 건은 건너뛰세요.` : null;
}

/* 개인정보 2차 필터 — 모델이 지시를 어겨도 여기서 걸린다 */
const PLATE_RE = /\d{2,3}\s?[가-힣]\s?\d{4}/;
const PHONE_RE = /0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/;

export function privacyFilter(text: string, redact: string[]): string | null {
  if (PLATE_RE.test(text)) return "번호판으로 보이는 글자";
  if (PHONE_RE.test(text)) return "전화번호로 보이는 글자";
  for (const r of redact) {
    const s = r.trim();
    if (s.length >= 2 && text.includes(s)) return `손님 이름·메모 「${s.slice(0, 1)}…」`;
  }
  return null;
}

/** 복사할 최종 글 — 사장님 한마디가 자리에 들어간다 */
export function composeForCopy(
  d: { titles: string[]; body: string; tags: string[]; ownerNote: string | null },
  titleIdx: number,
): string {
  const note = (d.ownerNote ?? "").trim();
  const body = d.body.replace(OWNER_SLOT, note);
  const tags = d.tags.map((t) => `#${t.replace(/^#/, "").replace(/\s+/g, "")}`).join(" ");
  return `${d.titles[titleIdx] ?? d.titles[0]}\n\n${body}\n\n${tags}`;
}
