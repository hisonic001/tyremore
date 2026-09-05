/**
 * 웹 페이지 글자에서 **오일 토크**를 뽑고 서로 견준다 (2026-09-05, 사장님 지시)
 *
 * 🔴 **AI 는 「어디를 볼지」만 고른다. 값은 여기서 우리가 뽑는다.**
 *    검색이 세 번 거짓말한 전력이 있다(메모 `vehicle-spec-db`). 방금도 한국어 검색이
 *    「일반적으로 20~30 N·m」이라는 **출처 없는 숫자**를 내놓았다 — 그런 건 들어오면 안 된다.
 *
 * 🔴 **두 곳 이상이 같은 값을 말할 때만** 후보로 삼는다. 어긋나면 값을 만들지 않고
 *    「어긋난다」고 남긴다. 그게 `vehicle_spec.conflict` 칸의 뜻이다.
 *
 * 🔴 이 파일은 순수하다 — `@/db` 도 `node:fs` 도 들이지 않는다.
 */

/** 우리가 찾는 두 가지 */
export type TorqueKind = "oil_drain_plug_torque" | "oil_filter_torque";

export interface TorqueHit {
  kind: TorqueKind;
  /** N·m 로 맞춘 값 */
  nm: number;
  nmMax: number | null;
  /** 페이지에 적힌 그대로 — 인용문으로 저장한다 */
  quote: string;
}

const NM_PER_FTLB = 1.35582;
const NM_PER_KGFM = 9.80665;

/**
 * 그 줄이 무엇에 대한 토크인가.
 * 🔴 「드레인」과 「필터」를 헷갈리면 안 된다 — 필터 값(25)을 드레인(35)으로 쓰면
 *    나사산이 덜 조여지고, 반대면 오일팬이 상한다.
 */
const DRAIN_RE = /(drain\s*(plug|bolt)|드레인\s*(플러그|볼트)|오일\s*팬\s*볼트|sump\s*plug)/i;
const FILTER_RE = /(oil\s*filter|오일\s*필터|필터\s*(캡|하우징)|filter\s*(cap|housing))/i;

/** 「35 Nm」·「26 ft-lbs」·「3.5 kgf·m」·「35~45 N·m」·「40±5 N·m」 */
const NUM_UNIT_RE =
  /(\d{1,3}(?:\.\d)?)\s*(?:(?:~|-|to|±)\s*(\d{1,3}(?:\.\d)?))?\s*(n[·.\s]?m|nm|ft[-\s]?lbs?|lb[-\s]?ft|kgf[·.\s]?m|kg[·.\s]?m)/i;

function toNm(v: number, unit: string): number | null {
  const u = unit.toLowerCase().replace(/[·.\s-]/g, "");
  if (u === "nm") return v;
  if (u === "ftlbs" || u === "ftlb" || u === "lbft") return v * NM_PER_FTLB;
  if (u === "kgfm" || u === "kgm") return v * NM_PER_KGFM;
  return null;
}

/** 사람이 쓰는 값의 상식 범위 — 밖이면 그 줄은 우리 것이 아니다 */
const SANE: Record<TorqueKind, { min: number; max: number }> = {
  oil_drain_plug_torque: { min: 15, max: 70 },
  oil_filter_torque: { min: 8, max: 45 },
};

/**
 * 페이지 글자에서 토크를 뽑는다.
 *
 * 🔴 **한 줄 안에 「무엇의 토크인지」와 「숫자·단위」가 같이 있어야** 한다.
 *    멀리 떨어진 숫자를 끌어오면 엉뚱한 부품의 토크가 붙는다.
 */
export function findTorques(text: string): TorqueHit[] {
  const out: TorqueHit[] = [];
  const lines = text
    .split(/\n|(?<=[.。])\s+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 4 && l.length <= 300);

  for (const line of lines) {
    const isDrain = DRAIN_RE.test(line);
    const isFilter = FILTER_RE.test(line);
    /* 둘 다 걸린 줄은 어느 쪽 값인지 알 수 없다 — 버린다 */
    if (isDrain === isFilter) continue;
    const m = NUM_UNIT_RE.exec(line);
    if (!m) continue;

    const kind: TorqueKind = isDrain ? "oil_drain_plug_torque" : "oil_filter_torque";
    const a = toNm(Number(m[1]), m[3]);
    if (a === null) continue;
    let lo = a;
    let hi: number | null = null;
    if (m[2] !== undefined) {
      const b = toNm(Number(m[2]), m[3]);
      if (b !== null) {
        /* 「40±5」는 35~45 다 */
        if (/±/.test(line.slice(m.index, m.index + m[0].length))) {
          lo = a - b;
          hi = a + b;
        } else {
          lo = Math.min(a, b);
          hi = Math.max(a, b);
        }
      }
    }
    const band = SANE[kind];
    if (lo < band.min || lo > band.max) continue;
    if (hi !== null && (hi < band.min || hi > band.max)) continue;

    out.push({ kind, nm: Math.round(lo * 10) / 10, nmMax: hi === null ? null : Math.round(hi * 10) / 10, quote: line });
  }
  return out;
}

export interface SourceHits {
  /** 어느 사이트에서 봤나 — 같은 사이트 여러 쪽은 한 곳으로 센다 */
  host: string;
  url: string;
  hits: TorqueHit[];
}

export interface Agreement {
  kind: TorqueKind;
  nm: number;
  nmMax: number | null;
  /** 같은 값을 말한 사이트들 */
  hosts: string[];
  /** 서로 다른 값을 말한 사이트가 있나 */
  conflict: boolean;
  /** 어긋난 값들 — 화면에 그대로 보여 준다 */
  others: { host: string; nm: number }[];
}

/**
 * ⭐ **두 곳 이상이 같은 값을 말하는가**
 *
 * 🔴 「몇 쪽에서 봤나」가 아니라 「**서로 다른 사이트** 몇 곳인가」다.
 *    한 사이트가 열 쪽에 같은 말을 써도 한 곳이다.
 *
 * 🔴 어긋나는 값이 있으면 `conflict` 로 남긴다. **조용히 다수결로 고르지 않는다** —
 *    어느 쪽이 맞는지는 사장님이 정하신다. 틀린 토크는 없는 것보다 나쁘다.
 */
export function agreeAcrossSources(sources: SourceHits[], kind: TorqueKind, tolerance = 0.06): Agreement | null {
  /** 사이트마다 그 종류의 값 하나만 — 같은 사이트 안에서 여러 값이면 가장 흔한 것 */
  const perHost = new Map<string, { nm: number; nmMax: number | null }>();
  for (const s of sources) {
    const mine = s.hits.filter((h) => h.kind === kind);
    if (!mine.length) continue;
    const counts = new Map<number, number>();
    for (const h of mine) counts.set(h.nm, (counts.get(h.nm) ?? 0) + 1);
    const best = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const one = mine.find((h) => h.nm === best)!;
    perHost.set(s.host, { nm: one.nm, nmMax: one.nmMax });
  }
  if (perHost.size < 2) return null;

  /* 값이 가까운 것끼리 묶는다 (35 와 35.3 은 같은 말이다) */
  const entries = [...perHost.entries()];
  let best: { nm: number; nmMax: number | null; hosts: string[] } | null = null;
  for (const [, v] of entries) {
    const hosts = entries
      .filter(([, w]) => Math.abs(w.nm - v.nm) / Math.max(v.nm, 1) <= tolerance)
      .map(([h]) => h);
    if (!best || hosts.length > best.hosts.length) best = { nm: v.nm, nmMax: v.nmMax, hosts };
  }
  if (!best || best.hosts.length < 2) {
    /* 아무 둘도 안 맞으면 값을 만들지 않는다 — 어긋났다는 사실만 남긴다 */
    return {
      kind,
      nm: entries[0][1].nm,
      nmMax: entries[0][1].nmMax,
      hosts: [],
      conflict: true,
      others: entries.map(([h, w]) => ({ host: h, nm: w.nm })),
    };
  }
  const others = entries.filter(([h]) => !best!.hosts.includes(h)).map(([h, w]) => ({ host: h, nm: w.nm }));
  return { kind, nm: best.nm, nmMax: best.nmMax, hosts: best.hosts, conflict: others.length > 0, others };
}
