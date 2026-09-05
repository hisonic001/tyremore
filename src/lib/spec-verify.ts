/**
 * 제원 값 검사기 — 할루시네이션을 기계로 막는다 (D-04 3차 개정, 2026-09-03)
 *
 * 🔴 왜 이게 필요한가 — 2026-09-03 에 직접 겪은 세 가지:
 *   ① 검색엔진이 출처 없이 「일반적으로 10~12kgf·m 로 알려져 있습니다」라고 답했다.
 *   ② 검색이 준 출처 주소 두 개가 **둘 다 404** 였다. 근거가 살아 있지도 않았다.
 *   ③ 요약끼리 값이 어긋났다 — `250kPa(36psi)` vs `240kPa(35psi)`.
 *      **페이지를 직접 열어 보니 240kPa 가 맞았다.**
 *
 * 그래서 이 파일의 원칙은 하나다:
 *   **모델은 값을 만들지 않는다. 우리가 받아 온 원문에서 옮겨 적기만 한다.**
 *   옮겨 적었는지는 기계가 원문과 대조해서 확인한다.
 *
 * `blog-style.ts` 의 `styleFilter` 와 같은 모양이다 — 걸리면 `{reason, fix}` 를 돌려주고
 * 부르는 쪽이 그 지적을 지시문에 붙여 다시 쓰게 한다.
 *
 * 🔴 `@/db` 도 `node:fs` 도 import 하지 않는다 — 화면과 테스트가 같이 쓴다.
 */
import {
  convert,
  looksLikeTireSize,
  looksLikeViscosity,
  looksLikeWheelSize,
  normalizeUnit,
  specItem,
  tireRimInch,
  wheelRimInch,
} from "./spec-core";

export interface SpecCandidate {
  item: string;
  numMin?: number | null;
  numMax?: number | null;
  unit?: string | null;
  textValue?: string | null;
  /** 🔴 원문 인용 — 이게 없으면 값이 존재할 수 없다 */
  quote: string;
  /** 원문이 `230(33)` 처럼 두 단위를 같이 적을 때, 괄호 쪽 값 */
  altNum?: number | null;
  altUnit?: string | null;
}

export interface SpecProblem {
  /** 사장님이 읽을 한 줄 */
  reason: string;
  /** 모델에게 되돌려 줄 지적 */
  fix: string;
}

/**
 * 글자를 견주기 좋게 고른다 — 공백·전각·특수기호 때문에 「원문에 있는데 없다」가 되면 안 된다.
 */
export function normalizeForCompare(s: string): string {
  return String(s ?? "")
    .replace(/ /g, " ")
    .replace(/[–—−~∼〜]/g, "~")
    .replace(/[․·ㆍ．]/g, ".")
    .replace(/[（(]/g, "(")
    .replace(/[）)]/g, ")")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** 글에서 숫자만 뽑는다 (`11~13` → ['11','13'], `6.1` → ['6.1']) */
export function numbersIn(s: string): string[] {
  return (String(s ?? "").match(/\d+(?:\.\d+)?/g) ?? []).map((n) => n.replace(/\.0+$/, ""));
}

/** 「대략」·「알려져 있다」 — 표가 아니라 남의 설명문을 인용한 것이다 */
const HEDGE = /일반적으로|대체로|대략|보통은|알려져\s*있|추정|아마|권장됩니다만|같습니다|듯/;

/**
 * 값 하나가 원문에서 나온 것인지 검사한다.
 *
 * @param c        모델이 내놓은 값 후보
 * @param sourceText 🔴 **우리가 직접 받아 온 페이지 본문.** 모델이 준 글이 아니다.
 * @param ctx      차체 종류(범위가 갈린다)·차종 코드(다른 차 매뉴얼 인용 방지)
 */
export function specFilter(
  c: SpecCandidate,
  sourceText: string,
  ctx: { bodyType?: string | null; projCode?: string | null; sourceUrl?: string | null } = {},
): SpecProblem | null {
  const def = specItem(c.item);
  if (!def) {
    return { reason: `모르는 항목입니다 (${c.item})`, fix: "정해진 항목 이름만 쓰세요." };
  }

  /* ① 인용이 있어야 한다 */
  const quote = String(c.quote ?? "").trim();
  if (quote.length < 4) {
    return {
      reason: `${def.label}: 원문 인용이 없습니다`,
      fix: "값마다 원문에서 그 값이 나오는 문장이나 표 줄을 quote 에 그대로 옮겨 담으세요.",
    };
  }

  /* ② 인용이 진짜 그 페이지에 있는가 — 지어낸 문장을 여기서 잡는다 */
  const hayStack = normalizeForCompare(sourceText);
  if (!hayStack.includes(normalizeForCompare(quote))) {
    return {
      reason: `${def.label}: 인용한 문장이 원문에 없습니다`,
      fix: "원문에 실제로 있는 글자만 quote 에 넣으세요. 요약하거나 고쳐 쓰지 말고 그대로 복사하세요.",
    };
  }

  /* ③ 얼버무리는 문장을 인용했는가 — 표가 아니라 설명문이다 */
  if (HEDGE.test(quote)) {
    return {
      reason: `${def.label}: 「${quote.slice(0, 20)}…」는 규정값이 아니라 설명문입니다`,
      fix: "「일반적으로」·「대략」·「알려져 있다」가 들어간 문장은 근거가 아닙니다. 제원표의 줄을 인용하세요.",
    };
  }

  /* ④ 값이 아예 없으면 — 그 줄을 만들지 않는 것이 정답이다 */
  const hasNum = c.numMin !== null && c.numMin !== undefined;
  const text = String(c.textValue ?? "").trim();
  if (!hasNum && !text) {
    return {
      reason: `${def.label}: 값이 비었습니다`,
      fix: "원문에 없으면 그 항목은 아예 빼고 not_found 에 이름만 적으세요. 추측은 오답보다 나쁩니다.",
    };
  }

  /* ⑤ 글자 값 — 모양이 맞는가 */
  if (text) {
    if (c.item === "tire_size" && !looksLikeTireSize(text))
      return { reason: `타이어 규격 모양이 아닙니다 (${text})`, fix: "235/60R18 같은 모양으로 원문 그대로 옮기세요." };
    if (c.item === "wheel_size" && !looksLikeWheelSize(text))
      return { reason: `휠 규격 모양이 아닙니다 (${text})`, fix: "7.5Jx18 같은 모양으로 원문 그대로 옮기세요." };
    if (c.item === "engine_oil_viscosity" && !looksLikeViscosity(text))
      return { reason: `점도 표기가 아닙니다 (${text})`, fix: "0W-20·5W-30 처럼 실제 점도 표기만 쓰세요." };

    /* 글자 값도 원문에 실제로 있어야 한다 */
    if (!hayStack.includes(normalizeForCompare(text))) {
      return {
        reason: `${def.label}: 「${text}」가 원문에 없습니다`,
        fix: "원문에 적힌 글자를 그대로 옮기세요.",
      };
    }
  }

  if (!hasNum) return null;

  /* ⑥ 숫자가 인용문 안에 실제로 있는가 — 「원문은 맞는데 숫자만 바꿔치기」를 잡는다 */
  const inQuote = new Set(numbersIn(quote));
  const want = [c.numMin, c.numMax].filter((v): v is number => v !== null && v !== undefined);
  for (const v of want) {
    const key = String(v).replace(/\.0+$/, "");
    if (!inQuote.has(key)) {
      return {
        reason: `${def.label}: 값 ${key} 가 인용문에 없습니다`,
        fix: `quote 에 그 숫자가 나오는 부분을 그대로 넣으세요. 지금 인용문에는 ${[...inQuote].slice(0, 6).join(", ")} 만 있습니다.`,
      };
    }
  }

  /* ⑦ 단위 */
  const unit = normalizeUnit(c.unit);
  if (!unit) {
    return { reason: `${def.label}: 단위가 없습니다`, fix: `단위를 함께 적으세요 (${def.units.join(" 또는 ")}).` };
  }
  if (def.units.length && !def.units.includes(unit)) {
    return {
      reason: `${def.label}: 쓸 수 없는 단위입니다 (${unit})`,
      fix: `이 항목의 단위는 ${def.units.join(" 또는 ")} 입니다.`,
    };
  }

  /* ⑧ 범위 검산 — 자릿수 사고와 단위 혼동을 여기서 잡는다 */
  const body = ctx.bodyType ?? undefined;
  const byBody = body && def.rangeByBody?.[body]?.[unit];
  const wide = def.range?.[unit];
  const band = byBody ?? wide;
  if (band) {
    for (const v of want) {
      if (v < band.min || v > band.max) {
        /**
         * 🔴 **같은 숫자를 다른 단위로 읽으면 딱 맞는가** — 그러면 단위를 잘못 적은 것이다.
         *    (환산이 아니다. `11 N·m` 라고 적힌 게 사실은 `11 kgf·m` 인 경우다.
         *     검색엔진이 실제로 이렇게 10배 틀리게 말했다 — 2026-09-03 실측)
         */
        for (const other of def.units) {
          if (other === unit) continue;
          const otherBand = def.rangeByBody?.[body ?? ""]?.[other] ?? def.range?.[other];
          if (otherBand && v >= otherBand.min && v <= otherBand.max) {
            const ratio = convert(1, other, unit);
            return {
              reason: `${def.label}: 단위를 잘못 적었습니다 — ${v} 는 ${unit} 가 아니라 ${other} 입니다`,
              fix:
                `원문의 단위를 그대로 옮기세요. ${unit} 와 ${other} 를 바꿔 적으면` +
                (ratio ? ` 약 ${Math.round(ratio * 10) / 10}배` : "") +
                ` 틀립니다.`,
            };
          }
        }
        return {
          reason: `${def.label}: ${v}${unit} 는 정상 범위(${band.min}~${band.max}${unit})를 벗어납니다`,
          fix: `원문을 다시 보세요. 이 값이 정말 맞다면 단위나 항목이 잘못됐을 가능성이 큽니다.`,
        };
      }
    }
  }

  /* ⑨ 앞뒤 관계 */
  if (c.numMax !== null && c.numMax !== undefined && c.numMin !== null && c.numMin !== undefined && c.numMax < c.numMin) {
    return { reason: `${def.label}: 최소·최대가 뒤바뀌었습니다`, fix: "작은 값을 numMin, 큰 값을 numMax 에 넣으세요." };
  }

  /* ⑩ 환산 교차검산 — 원문이 `230(33)` 처럼 두 단위를 같이 적어 주면 우리가 계산해 본다 */
  const altUnit = normalizeUnit(c.altUnit);
  if (altUnit && c.altNum !== null && c.altNum !== undefined && c.numMin !== null && c.numMin !== undefined) {
    const expect = convert(c.numMin, unit, altUnit);
    /**
     * 🔴 2% 다. 5% 로 두면 「250kPa(35psi)」가 통과한다 — 실제로 검색 요약이 그렇게 틀렸고
     *    페이지 원문은 240kPa 였다. 제조사 반올림(240→34.8→'35')은 0.6% 라 넉넉히 통과한다.
     */
    if (expect !== null && Math.abs(expect - c.altNum) / Math.max(expect, 1) > 0.02) {
      return {
        reason: `${def.label}: 두 단위가 서로 안 맞습니다 (${c.numMin}${unit} 이면 ${expect.toFixed(0)}${altUnit} 인데 ${c.altNum}${altUnit} 라고 적혔습니다)`,
        fix: "원문 표에 적힌 두 값을 그대로 옮기세요. 계산해서 채우지 마세요.",
      };
    }
  }

  return null;
}

/** 제조사 공식 문서인가 — 여기 없으면 「미확인」에서 못 올라간다 */
const OFFICIAL_HOSTS = [
  "ownersmanual.hyundai.com",
  "ownersmanual.kia.com",
  "ownersmanual.genesis.com",
  "owners.hyundai.com",
  "www.kia.com",
  "service.tesla.com",
  "webmanual.kia.com",
  "webmanual.hyundai.com",
  "www.genesis.com",
  /**
   * 🔴 현대 공식 자료실 — 「취급설명서 (단종차종)」 PDF 2,669건이 여기 있다.
   *    제조사 온라인 설명서에는 **현행 세대만** 올라오므로, 구형(그랜드 스타렉스 TQ ·
   *    싼타페 DM · 그랜저 HG · 아반떼 AD …)은 여기서만 구할 수 있다 (2026-09-03 확인).
   */
  "www.hyundai.com",
];

export type SourceRank = 1 | 2 | 3 | 4 | 5;

/**
 * 출처의 등급과 **독립성 열쇠**.
 *
 * 🔴 교차검증은 「몇 곳에서 봤나」가 아니라 「서로 **다른 발행자** 몇 곳인가」다.
 *    커뮤니티 열 곳이 같은 말을 해도 원본이 하나면 1개다 — 전부 `community` 로 묶는다.
 */
export function rankSource(url: string): { rank: SourceRank; independenceKey: string; official: boolean } {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { rank: 5, independenceKey: "unknown", official: false };
  }
  if (OFFICIAL_HOSTS.includes(host)) {
    /** 같은 제조사의 취급설명서와 정비지침서는 같은 발행자다 — 하나로 센다 */
    const maker = host.includes("kia")
      ? "kia"
      : host.includes("hyundai")
        ? "hyundai"
        : host.includes("tesla")
          ? "tesla"
          : host.includes("genesis")
            ? "genesis"
            : host;
    return { rank: 1, independenceKey: maker, official: true };
  }
  if (/danawa|carisyou|encar|kbchachacha/.test(host))
    return { rank: 4, independenceKey: `media:${host}`, official: false };
  return { rank: 5, independenceKey: "community", official: false };
}

/* ------------------------------------------------------------------ */
/* 교차검산 — 자동 확인을 받을 자격이 있는가                              */
/* ------------------------------------------------------------------ */

/** 한 벌(그룹) 안의 값들 — 서로 아귀가 맞는지 볼 때 쓴다 */
export interface GroupRow {
  item: string;
  textValue: string | null;
  numMin: number | null;
  unit: string | null;
  /** qualifier 의 「위치」 (앞/뒤) */
  where?: string | null;
}

export interface CrossResult {
  /** 자동 확인을 줘도 되는가 */
  ok: boolean;
  /** 왜 됐는지 / 왜 안 됐는지 — 화면과 `auto_note` 에 그대로 적는다 */
  note: string;
}

/**
 * ⭐ **교차검산** (2026-09-05, 사장님 「검수할 게 너무 많다」)
 *
 * 🔴 정직하게: 지금 우리 값은 **출처가 하나씩뿐**이다(값 592개에 인용 592건).
 *    그래서 「서로 다른 두 곳이 같은 말을 하면 승인」은 **0건을 승인한다.**
 *    대신 **우리가 실제로 할 수 있는 검산**을 한다 — 서로 다른 값이 같은 사실을
 *    가리킬 때 그것들이 아귀가 맞는지 보는 것이다.
 *
 *    ① 타이어 규격의 림 인치 == 휠 규격의 인치 (245/45R19 ↔ 8.5Jx19)
 *       두 값은 표의 다른 칸에서 따로 읽어 온 것이라, 맞으면 둘 다 제대로 읽은 것이다
 *    ② 앞/뒤가 붙은 값은 **앞도 뒤도 다 있어야** 한다 — 한쪽만 있으면 표를 반만 읽은 것이다
 *    ③ 이웃과 크게 안 튀는가는 부르는 쪽이 넣어 준다 (`neighborMedian`)
 *
 * 🔴 `specFilter` 를 이미 통과한 값에만 쓴다. 이건 그 위에 얹는 두 번째 눈이다.
 */
export function crossCheckSpec(
  row: GroupRow,
  group: GroupRow[],
  opts?: { neighborMedian?: number | null },
): CrossResult {
  /* ① 타이어 ↔ 휠 인치가 맞나 */
  if (row.item === "tire_size" || row.item === "wheel_size") {
    const tire = group.find((r) => r.item === "tire_size" && r.textValue && sameSide(r, row));
    const wheel = group.find((r) => r.item === "wheel_size" && r.textValue && sameSide(r, row));
    if (tire?.textValue && wheel?.textValue) {
      const a = tireRimInch(tire.textValue);
      const b = wheelRimInch(wheel.textValue);
      if (a !== null && b !== null) {
        if (a !== b) return { ok: false, note: `타이어는 ${a}인치인데 휠은 ${b}인치입니다` };
        return { ok: true, note: `타이어와 휠이 둘 다 ${a}인치로 맞습니다` };
      }
    }
    /* 짝이 없으면 검산할 것이 없다 — 통과시키되 그렇게 적는다 */
    return { ok: true, note: "모양 검사를 통과했습니다 (맞춰 볼 짝이 없습니다)" };
  }

  /* ② 앞/뒤가 붙은 값은 짝이 온전해야 한다 */
  if (row.where) {
    const mates = group.filter((r) => r.item === row.item && r.where);
    const hasFront = mates.some((r) => r.where === "앞");
    const hasRear = mates.some((r) => r.where === "뒤");
    if (!hasFront || !hasRear) {
      return { ok: false, note: `앞뒤 중 ${hasFront ? "뒤" : "앞"}가 없습니다 — 표를 반만 읽었을 수 있습니다` };
    }
  }

  /* ③ 이웃과 크게 안 튀나 */
  const med = opts?.neighborMedian;
  if (row.numMin !== null && med !== null && med !== undefined && med > 0) {
    const off = Math.abs(row.numMin - med) / med;
    if (off > 0.3) {
      return { ok: false, note: `같은 제조사 다른 차들(가운데값 ${med})과 ${Math.round(off * 100)}% 차이가 납니다` };
    }
    return { ok: true, note: `같은 제조사 다른 차들과 비슷합니다 (가운데값 ${med})` };
  }

  return { ok: true, note: "모양·범위·인용 검사를 통과했습니다" };
}

/** 같은 위치(앞/뒤)끼리 견준다 — 스태거드는 앞은 앞끼리, 뒤는 뒤끼리 맞아야 한다 */
function sameSide(a: GroupRow, b: GroupRow): boolean {
  if (!a.where && !b.where) return true;
  return a.where === b.where;
}
