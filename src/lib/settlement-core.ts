/**
 * ⭐ 렌트카 거래처 월 정산 — 순수 규칙 (사장님 요청 2026-09-01)
 *
 *   서버 액션(settlement.ts)과 화면·테스트가 같은 규칙을 쓴다.
 *   여기는 DB 를 모른다 — 배분·회신 해석·매칭의 계산만 있다.
 */
import { normalizePlate } from "./normalize";

/* ============================================================
 * ① 건 단위 합의금액 → 품목 줄 단가 배분
 *
 *   거래처가 「이 건은 25,000원」처럼 건 합계만 주는 경우, 값 있는 줄들에
 *   비례로 나눈다. 총액 불변식(합계=Σ수량×단가)이 정확히 맞아야 하므로
 *   반올림 나머지는 금액이 가장 큰 줄이 안는다.
 *
 * 🔴 단가는 정수라, 나머지를 안는 줄의 수량이 2 이상이면 정확히 못 맞출 수
 *    있다 — 그때는 수량 1인 줄을 찾아 나머지를 옮기고, 그것도 없으면
 *    「줄별로 직접 입력」하시라고 돌려보낸다. (실측: 렌트카 공임은 거의 수량 1)
 * ========================================================== */
export interface AdjustItem {
  itemId: number;
  qty: number;
  price: number;
}

export function planAdjustment(
  items: AdjustItem[],
  agreedTotal: number,
): { ok: true; changes: { itemId: number; newPrice: number }[] } | { ok: false; error: string } {
  if (!Number.isInteger(agreedTotal) || agreedTotal < 0) {
    return { ok: false, error: "합의금액이 올바르지 않습니다" };
  }
  // 0원 줄(부품 소모 use 등)은 배분에서 뺀다 — 0원인 이유가 있는 줄이다
  const live = items.filter((i) => i.qty > 0 && i.price * i.qty > 0);
  if (live.length === 0) return { ok: false, error: "배분할 품목 줄이 없습니다" };
  const total = live.reduce((s, i) => s + i.qty * i.price, 0);
  if (total === agreedTotal) return { ok: true, changes: [] };

  // 큰 줄이 마지막에 나머지를 안도록 정렬
  const sorted = [...live].sort((a, b) => a.qty * a.price - b.qty * b.price);
  const changes: { itemId: number; newPrice: number }[] = [];
  let assigned = 0;
  for (let k = 0; k < sorted.length - 1; k++) {
    const it = sorted[k];
    // 목표 줄 합계를 비례로 잡되, 수량의 배수로 내림해 단가를 정수로
    const target = Math.floor((agreedTotal * (it.qty * it.price)) / total);
    const newPrice = Math.max(0, Math.floor(target / it.qty));
    changes.push({ itemId: it.itemId, newPrice });
    assigned += newPrice * it.qty;
  }
  const last = sorted[sorted.length - 1];
  let leftover = agreedTotal - assigned;
  if (leftover < 0) return { ok: false, error: "합의금액이 너무 작아 배분할 수 없습니다 — 줄별로 직접 입력해 주세요" };
  if (leftover % last.qty !== 0) {
    // 나머지가 수량으로 안 나뉘면, 수량 1인 다른 줄이 자투리를 안는다
    const residue = leftover % last.qty;
    const qty1 = changes.find((c) => sorted.find((s) => s.itemId === c.itemId)!.qty === 1);
    if (!qty1) {
      return { ok: false, error: "수량이 여러 개인 줄뿐이라 정확히 나눌 수 없습니다 — 줄별로 직접 입력해 주세요" };
    }
    qty1.newPrice += residue;
    leftover -= residue;
  }
  changes.push({ itemId: last.itemId, newPrice: leftover / last.qty });
  // 검산 — 규칙이 틀리면 여기서 잡는다 (총액 불변식은 절대 어기면 안 된다)
  const check = changes.reduce((s, c) => s + c.newPrice * sorted.find((x) => x.itemId === c.itemId)!.qty, 0);
  if (check !== agreedTotal || changes.some((c) => c.newPrice < 0)) {
    return { ok: false, error: "배분 계산이 맞지 않습니다 — 줄별로 직접 입력해 주세요" };
  }
  return { ok: true, changes: changes.filter((c) => c.newPrice !== live.find((i) => i.itemId === c.itemId)!.price) };
}

/* ============================================================
 * ② 회신 글 해석 — 붙여넣기(탭·여러 칸·파이프)와 엑셀 행이 같은 길로 모인다
 *
 *   우리가 내보낸 청구서엔 관리번호(Q26-…)가 있어 돌아오면 그대로 이어지고,
 *   거래처 자체 양식이면 차량번호로 잇는다.
 * ========================================================== */
export interface ReplyRow {
  /** 우리 관리번호 (있으면 매칭 확실) */
  quoteNo: string | null;
  plateRaw: string | null;
  plateNorm: string | null;
  /** 숫자·번호 칸을 뺀 나머지 글 (점검내용 등) */
  desc: string;
  /** 줄에서 찾은 금액들 (앞 = 원 청구 추정, 뒤 = 승인 추정) */
  amounts: number[];
  raw: string;
}

const PLATE_RE = /\b(\d{2,3}[가-힣]\s?\d{4})\b/;
const QUOTE_NO_RE = /\b(Q\d{2}-\d{4}-\d{3})\b/;
const won = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;

export function parseReplyText(text: string): ReplyRow[] {
  const out: ReplyRow[] = [];
  for (const line of (text ?? "").replace(/ /g, " ").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const cells = t.split(/\t|\s{2,}|\s*\|\s*/).map((c) => c.trim()).filter(Boolean);
    const joined = cells.join(" ");
    // 머리글 줄은 건너뛴다
    if (/차량번호|점검내용|정비금액|승인금액|최종금액|관리번호/.test(joined) && !PLATE_RE.test(joined)) continue;
    const quoteNo = QUOTE_NO_RE.exec(joined)?.[1] ?? null;
    const plateRaw = PLATE_RE.exec(joined)?.[1] ?? null;
    const amounts = cells
      .filter((c) => /^-?[\d,]+원?$/.test(c) && won(c) >= 100) // 100원 미만 숫자는 번호·수량으로 본다
      .map(won);
    if (!quoteNo && !plateRaw && amounts.length === 0) continue;
    const desc = cells
      .filter((c) => !/^-?[\d,]+원?$/.test(c) && !QUOTE_NO_RE.test(c) && !PLATE_RE.test(c))
      .join(" ")
      .slice(0, 120);
    out.push({
      quoteNo,
      plateRaw,
      plateNorm: plateRaw ? normalizePlate(plateRaw) : null,
      desc,
      amounts,
      raw: t.slice(0, 200),
    });
  }
  return out;
}

/* ============================================================
 * ③ 회신 ↔ 우리 판매 잇기
 * ========================================================== */
export interface OurLine {
  lineId: number;
  quoteId: number;
  quoteNo: string;
  plateNorm: string | null;
  billed: number;
  workDate: string;
}

export interface MatchedReply {
  lineId: number;
  matchedBy: "관리번호" | "차량번호" | "차량+금액";
  /** 회신에서 읽은 합의 금액 (그 판매로 모인 줄들의 승인 추정 합) */
  agreed: number | null;
  memo: string;
}

export interface MatchResult {
  matched: MatchedReply[];
  /** 후보가 없거나 여럿 — 화면에서 사장님이 고른다 */
  ambiguous: { row: ReplyRow; candidates: OurLine[] }[];
  /** 우리 것과 못 이은 회신 줄 */
  unmatched: ReplyRow[];
}

/** 줄의 승인 금액 추정 — 마지막 금액 칸 (우리 청구·승인 두 칸이면 뒤가 승인) */
function approvedOf(row: ReplyRow): number | null {
  return row.amounts.length > 0 ? row.amounts[row.amounts.length - 1] : null;
}

export function matchReply(rows: ReplyRow[], ours: OurLine[], vatMode: "포함" | "별도"): MatchResult {
  const byQuoteNo = new Map(ours.map((o) => [o.quoteNo, o]));
  const byPlate = new Map<string, OurLine[]>();
  for (const o of ours) {
    if (!o.plateNorm) continue;
    byPlate.set(o.plateNorm, [...(byPlate.get(o.plateNorm) ?? []), o]);
  }

  /** 판매별로 모인 회신 줄들 (한 판매의 품목이 여러 줄로 온다 — 승인액은 합산) */
  const agg = new Map<number, { line: OurLine; by: MatchedReply["matchedBy"]; sum: number; any: boolean; memos: string[] }>();
  const ambiguous: MatchResult["ambiguous"] = [];
  const unmatched: ReplyRow[] = [];

  /** 차량번호가 같은 여러 판매 중에서 금액으로 좁힌다 — 별도 업체는 ×1.1 회신도 있다 */
  const narrowByAmount = (cands: OurLine[], row: ReplyRow): OurLine[] => {
    const hits = cands.filter((c) =>
      row.amounts.some((a) => a === c.billed || (vatMode === "별도" && Math.round(a / 1.1) === c.billed)),
    );
    return hits.length > 0 ? hits : cands;
  };

  let carry: OurLine | null = null; // 차량번호 없는 이어지는 줄(같은 표의 추가 품목)은 직전 판매로
  for (const row of rows) {
    let hit: OurLine | null = null;
    let by: MatchedReply["matchedBy"] | null = null;
    if (row.quoteNo && byQuoteNo.has(row.quoteNo)) {
      hit = byQuoteNo.get(row.quoteNo)!;
      by = "관리번호";
    } else if (row.plateNorm) {
      const cands = byPlate.get(row.plateNorm) ?? [];
      if (cands.length === 1) {
        hit = cands[0];
        by = "차량번호";
      } else if (cands.length > 1) {
        const narrowed = narrowByAmount(cands, row);
        if (narrowed.length === 1) {
          hit = narrowed[0];
          by = "차량+금액";
        } else {
          ambiguous.push({ row, candidates: cands });
          carry = null;
          continue;
        }
      } else {
        unmatched.push(row);
        carry = null;
        continue;
      }
    } else if (carry && row.amounts.length > 0) {
      hit = carry; // 「(같은 차) 와이퍼 9,500」 같은 이어지는 품목 줄
      by = agg.get(carry.lineId)?.by ?? "차량번호";
    } else {
      unmatched.push(row);
      continue;
    }
    carry = hit;
    const cur = agg.get(hit.lineId) ?? { line: hit, by: by!, sum: 0, any: false, memos: [] };
    const a = approvedOf(row);
    if (a != null) {
      cur.sum += a;
      cur.any = true;
    }
    if (row.desc) cur.memos.push(row.desc);
    agg.set(hit.lineId, cur);
  }

  const matched: MatchedReply[] = [...agg.values()].map((g) => {
    // 별도 업체 회신이 세포함 합계면 우리 저장 기준(세별도)으로 환산해 본다
    let agreed = g.any ? g.sum : null;
    if (agreed != null && vatMode === "별도" && agreed !== g.line.billed && Math.round(agreed / 1.1) === g.line.billed) {
      agreed = g.line.billed;
    }
    return {
      lineId: g.line.lineId,
      matchedBy: g.by,
      agreed,
      memo: g.memos.join(" · ").slice(0, 200),
    };
  });
  return { matched, ambiguous, unmatched };
}
