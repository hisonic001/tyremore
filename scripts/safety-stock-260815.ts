/**
 * 부품 안전재고 제안 (사장님 요청 2026-08-15)
 *
 * 대상: 필터류(오일·에어·에어컨) + 배터리 + 브레이크패드 — 와이퍼 등은 제외 (사장님 지시)
 * 자료: 부품몰 카탈로그 2,927종 + 우리 재고 + **MARS 입차 내역 2,040건(2026년)**
 *       + 쏘카 오더 194건 + 배터리 매입 명세 354개
 *
 * 산출 방법
 *   ① 분류별 월 수요를 **입차·쏘카·매입 실측**에서 잡는다 (사장님 지시 2026-08-15 —
 *      "앱기록은 데이터가 쌓이지 않아서 부족하기 때문에 쏘카 기록과 입차 내역을 토대로")
 *   ② 그 수요를 **입차 차종 실측 가중치**로 나눠 갖는다
 *   ③ 상위 품목만 1.5~2개월분 넉넉히 상비하고 나머지는 주문 대응 (부품몰 익일 배송)
 *
 * 🔴 조심한 것
 *   · **같은 자리 부품은 하나로 묶는다** — MBB-025(일반)·MBB-025_MOBIS(순정),
 *     MMA-017(일반)·MMA-C17(활성탄), MRA-B01_SM117(상신)·MRA-B01_SP1117(HI-Q) 은
 *     전부 같은 차에 들어간다. 따로 세면 두 배로 사게 된다.
 *   · **재고는 두 코드 체계에 흩어져 있다** — 패드 재고는 옛 SM·FP 코드에, 카탈로그는
 *     MRA-F45_SP1174A 형태다. 접미 코드까지 맞춰 봐야 128개가 제대로 잡힌다.
 *   · 하향은 **신형 제네시스 전용**만 — 입차를 보니 구형 G80(DH)·BH 가 119건이나 온다.
 *
 * 실행: npx tsx scripts/safety-stock-260815.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
import * as XLSX from "xlsx";
import { readSheet } from "./lib/excel";

config({ path: ".env.local" });

const XLS = "C:/Users/info/OneDrive/문서/통합자동화/부품전체상품목록_260813.xls";
const OUT = "C:/Users/info/OneDrive/문서/통합자동화/안전재고_제안_2608.xlsx";

/**
 * ① 차종 수요 가중치 — **입차 실측**(MARS 완료 송장 2026년 2,040건) + 쏘카 오더 194건.
 *
 * 🔴 앱 공임 기록은 못 쓴다 (2026-08-15 확인): 올해 판매 3,282건 중 3,112건이
 *    「MARS 정비 이관(품목 내역 없음)」이라 품목이 남아 있는 건 5%뿐이다.
 *    그래서 사장님 지시대로 **쏘카 기록 + 입차 내역**을 근거로 삼는다.
 *
 * 입차 실측이 바로잡아 준 것:
 *   · 제네시스가 119건(3위)로 실제로 많이 온다 — 구형 G80(DH)·BH 는 보증이 끝나 우리 손님이다.
 *     그래서 하향은 **신형(GV70·GV80·RG3·RS4)만** 한다.
 *   · 르노 79 · 쌍용(KG) 65 · 쉐보레 40 도 무시 못 할 규모 — 목록에 넣는다.
 */
const VEHICLE: [RegExp, number, string][] = [
  [/전차종|승용전차종|소형\s*전차종/i, 213, "전차종 범용"],
  [/포터|봉고/i, 213, "포터·봉고"],
  [/아반떼|아반테|CN7|엘란트라/i, 130, "아반떼"],
  [/그랜저|그랜져|그렌져|\bIG\b|\bHG\b|\bTG\b|GN7/i, 112, "그랜저"],
  [/싼타페/i, 98, "싼타페"],
  [/쏘나타|소나타|\bEF\b|\bNF\b|\bYF\b|\bLF\b|DN8/i, 95, "쏘나타"],
  [/모닝/i, 85, "모닝"],
  [/카니발/i, 82, "카니발"],
  [/스타렉스|스타리아/i, 81, "스타렉스·스타리아"],
  [/르노|삼성|\bSM[3567]\b|\bQM[356]\b|XM3|클리오/i, 79, "르노"],
  [/쏘렌토|소렌토|MQ4/i, 79, "쏘렌토"],
  [/투싼|투산|NX4/i, 69, "투싼"],
  [/티볼리|렉스턴|코란도|토레스|무쏘|액티언|카이런|로디우스/i, 65, "쌍용(KG)"],
  [/전기|EV\d|아이오닉|니로/i, 61, "전기차"],
  [/셀토스/i, 58, "셀토스"],
  [/스포티지|NQ5/i, 55, "스포티지"],
  [/레이\b/i, 53, "레이"],
  [/코나/i, 49, "코나"],
  [/K5\b/i, 47, "K5"],
  [/말리부|크루즈|올란도|트랙스|라세티|아베오|스파크|임팔라|알페온/i, 44, "쉐보레"],
  [/K7\b|K8\b|K9\b/i, 30, "K7·K8·K9"],
  [/K3\b/i, 30, "K3"],
  [/팰리세이드|펠리세이드/i, 23, "팰리세이드"],
  [/캐스퍼/i, 19, "캐스퍼"],
  [/모하비/i, 17, "모하비"],
  [/제네시스|G80|G90|G70|에쿠스|EQ900|\bDH\b|\bBH\b/i, 119, "제네시스(구형 포함)"],
];
/** 하향 대상은 **신형 제네시스 전용**만 — 아직 무상 쿠폰·전담 AS 기간이다 */
const GENESIS = /GV70|GV80|RG3|RS4|G80\s*\(RG3\)|G90\s*\(RS4\)/i;
const KIA_COUPON = /K7\b|K8\b|K9\b|스팅어|모하비/i;
const IMPORT =
  /BENZ|BMW|AUDI|VW|폭스바겐|아우디|벤츠|JAGUAR|재규어|랜드로버|포드|링컨|볼보|푸조|시트로엥|MINI|INFINITI|NISSAN|닛산|토요타|TOYOTA|렉서스|혼다|HONDA|테슬라|TESLA|폴스타|크라이슬러|지프|JEEP|포르쉐|캐딜락|미쓰비시|MITSUBISHI|스카니아|이베코|만TGA|이스즈|타타대우|GALANT|E클립스|ALTIMA/i;

type Cat = "오일필터" | "에어필터" | "에어컨필터" | "브레이크패드";
/**
 * 월 수요 — **입차 실측 + 쏘카 실측**에서 잡았다 (앱 공임 기록은 5%뿐이라 못 씀).
 *   입차 월 285건(2026년 2,040건 ÷ 7.2개월) · 쏘카 월 26건
 *   배터리는 매입 354개 − 현재고 104개 = 250개 소비 ÷ 7.5개월 = 월 33개 (실측)
 *   오일교환은 쏘카 8.4/월(실측)에 일반 손님을 더한 값 — 배터리와 비슷한 수준으로 본다
 */
const PLAN: Record<Cat, { d: number; months: number; topN: number; cap: number; note: string }> = {
  오일필터: { d: 30, months: 1.5, topN: 16, cap: 12, note: "월 30건 (쏘카 8.4 실측 + 일반 22 추정)" },
  에어컨필터: { d: 20, months: 1.5, topN: 16, cap: 10, note: "월 20건 (쏘카 8.4 실측 + 일반 12 추정)" },
  에어필터: { d: 12, months: 1.5, topN: 14, cap: 8, note: "월 12건 추정 (오일교환의 40%)" },
  브레이크패드: { d: 6, months: 2, topN: 12, cap: 3, note: "월 6건 추정 (입차의 2%) — 한 세트가 비싸 최소만" },
};
/** 🚗 쏘카 지정 정비 최소 상비 (그룹 대표 기준) */
const SOCAR_MIN: Record<string, [number, string]> = {
  "MBB-25": [8, "쏘카 아반떼CN7 48건·K3"],
  "MBB-2": [6, "쏘카 캐스퍼 14·모닝 11"],
  "MBA-44": [6, "쏘카 셀토스 40건"],
  "MBC-3": [4, "쏘카 레이 9건"],
  "MMA-59": [8, "쏘카 아반떼CN7·쏘나타·EV 공용"],
  "MMA-52": [6, "쏘카 코나 21·셀토스 40"],
  "MMB-29": [4, "쏘카 캐스퍼·모닝"],
  "MMB-16": [4, "쏘카 레이·모닝"],
  "MMA-24": [4, "쏘카 K3"],
  "MAA-123": [4, "쏘카 아반떼CN7"],
  "MAA-105": [4, "쏘카 셀토스·K3"],
  "MAB-103": [3, "쏘카 캐스퍼"],
  "MAB-91": [3, "쏘카 레이"],
};

/* 배터리 — 매입 실적 (싸군 코드) */
const BATT: Record<string, number> = {
  HK80L: 80, HK80DL: 33, HK90R: 32, HK74DL: 28, "LN2/60": 20, HK100L: 19,
  "LN4/80": 17, HK90L: 16, HK40FL: 10, HK120L: 10, "LN3/70": 9, HK50L: 8,
  HK150L: 8, HK200L: 8, "LN5/95": 7, HK60L: 7, HK100R: 6, HK170L: 6,
  에너자이저90R: 5, HK100DL: 4, DIN74R: 3, HK44DL: 2, HK62DL: 2, HK50DL: 2,
  AGM105DL: 2, HK80R: 2, "LN6/105": 1, "DF250L(75019)": 1, DF170L: 2,
};
const BATT_MISSING: [string, number, string][] = [
  ["RAGM80 R", 4, "우단자 AGM(스타리아·GV70 등) — 품목 미등록, 가격 확인 필요"],
  ["RAGM95 R", 2, "우단자 AGM(G80·GV80) — 품목 미등록"],
];
function battSafe(no: string, bought: number): number {
  let n = Math.ceil((bought / 7.5) * 1.0); // 넉넉하게 1개월분
  if (/^LN2/.test(no)) n = Math.max(n, 4);
  if (/HK40FL|HK50L/.test(no)) n = Math.max(n, 3);
  if (/HK62DL/.test(no)) n = Math.max(n, 3);
  return Math.min(n, 12);
}

function catOf(raw: string): Cat | null {
  const c = raw.trim();
  if (c === "오일필터") return "오일필터";
  if (c === "에어필터") return "에어필터";
  if (c === "에어컨필터" || c === "에어컨필터(활성탄)") return "에어컨필터";
  if (c === "브레이크(앞패드)" || c === "브레이크(뒷패드)" || c === "브레이크 패드") return "브레이크패드";
  return null;
}
/**
 * 같은 자리 부품 묶기 — 순정(_MOBIS)·활성탄(C)·브랜드(SM/SP)·
 * 「와셔/드레인볼트 포함」(끝 P) 차이를 지운다.
 */
function groupKey(no: string): string {
  let b = no.includes("_") ? no.slice(0, no.indexOf("_")) : no;
  b = b.replace(/^([A-Z]{2,3})-C(\d)/i, "$1-$2"); // 활성탄
  // 「-023P」(와셔 포함) 도 「-023」과 같은 자리다. 앞의 B/F(앞뒤)는 살린다
  b = b.replace(/-([A-Z]?)0*(\d+)[A-Z]?$/i, (_m, p: string, d: string) => `-${p}${d}`);
  return b.toUpperCase();
}
/**
 * 🔴 20년 넘은 세대는 가중치를 깎는다 (2026-08-15).
 *    「EF쏘나타」에 쏘나타 가중치를 그대로 주면 1998년식 차 부품을 상비하게 된다.
 *    아예 0으로 두지는 않는다 — 시골 매장엔 가끔 온다.
 */
const OLD_GEN =
  /\bEF\b|\bXG\b|마르샤|엑셀|산타모|라비타|다이너스티|세피아|아토스|비스토|트라제|프레지오|그레이스|구형|스타렉스\s*구/i;
function score(t: string) {
  let pts = 0;
  const hits: string[] = [];
  for (const [re, w, label] of VEHICLE) if (re.test(t)) { pts += w; hits.push(label); }
  if (pts > 0 && OLD_GEN.test(t) && !/전차종/.test(t)) pts = Math.round(pts * 0.35);
  return { pts, hits };
}

interface Item {
  cat: Cat; no: string; suffix: string; key: string; name: string;
  price: number; pts: number; hits: string[]; position: string;
}

async function main() {
  let wb0 = XLSX.readFile(XLS, { cellDates: false });
  let sh = readSheet(wb0, wb0.SheetNames[0]);
  if (!sh.headers.includes("상품코드")) {
    wb0 = XLSX.readFile(XLS, { cellDates: false, codepage: 949 });
    sh = readSheet(wb0, wb0.SheetNames[0]);
  }
  const items = new Map<string, Item>();
  for (const r of sh.rows) {
    const rawCat = String(r["필터"] ?? "").trim();
    const cat = catOf(rawCat);
    if (!cat) continue;
    const no = String(r["NICE"] ?? "").trim();
    const name = String(r["상품명"] ?? "").trim();
    if (!no || !name || /순정부품\s*1\s*BOX/i.test(name)) continue;
    const price = Number(String(r["판매가"] ?? "0").replace(/,/g, "")) || 0;
    const s = score(`${name} ${no}`);
    const it: Item = {
      cat, no, suffix: no.includes("_") ? no.slice(no.indexOf("_") + 1) : "",
      key: groupKey(no), name, price, pts: s.pts, hits: s.hits,
      position: rawCat === "브레이크(앞패드)" ? "앞" : rawCat === "브레이크(뒷패드)" ? "뒤" : "",
    };
    const prev = items.get(no);
    if (!prev || (price > 0 && price < prev.price)) items.set(no, it);
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const dbRows = await sql<{ part_no: string; qty: number; name: string; category: string }[]>`
    SELECT p.part_no, COALESCE(s.qty,0)::int qty,
           COALESCE(NULLIF(p.display_name,''), p.raw_name) name, COALESCE(p.category,'') category
    FROM product p
    LEFT JOIN (SELECT product_id, SUM(qty)::int qty FROM stock_item WHERE status='재고' GROUP BY product_id) s
      ON s.product_id = p.id
    WHERE p.item_type='part' AND p.is_active AND p.part_no IS NOT NULL`;
  await sql.end();
  const stock = new Map<string, number>();
  for (const r of dbRows) {
    const k = r.part_no.toUpperCase();
    stock.set(k, (stock.get(k) ?? 0) + r.qty);
  }
  const have = (it: Item) =>
    (stock.get(it.no.toUpperCase()) ?? 0) + (it.suffix ? (stock.get(it.suffix.toUpperCase()) ?? 0) : 0);

  /* ── 그룹 단위로 수요를 나눠 갖는다 ── */
  interface Grp { key: string; cat: Cat; pts: number; hits: string[]; members: Item[]; qty: number }
  const groups = new Map<string, Grp>();
  for (const it of items.values()) {
    const text = `${it.name} ${it.no}`;
    if (IMPORT.test(text)) continue;
    const g = groups.get(it.key) ?? { key: it.key, cat: it.cat, pts: 0, hits: [], members: [], qty: 0 };
    g.pts = Math.max(g.pts, it.pts);
    if (it.hits.length > g.hits.length) g.hits = it.hits;
    g.members.push(it);
    g.qty += have(it);
    groups.set(it.key, g);
  }

  const grpSafe = new Map<string, { n: number; why: string }>();
  for (const cat of Object.keys(PLAN) as Cat[]) {
    const p = PLAN[cat];
    const cands = [...groups.values()]
      .filter((g) => g.cat === cat && g.pts > 0)
      .filter((g) => !g.members.every((m) => GENESIS.test(m.name)) || g.pts > 70)
      .filter((g) => !(cat === "오일필터" && g.members.every((m) => KIA_COUPON.test(m.name)) && g.pts <= 70))
      .sort((a, b) => b.pts - a.pts)
      .slice(0, p.topN);
    const sum = cands.reduce((s, g) => s + g.pts, 0) || 1;
    for (const g of cands) {
      const share = g.pts / sum;
      const n = Math.max(1, Math.min(p.cap, Math.round(share * p.d * p.months)));
      grpSafe.set(g.key, { n, why: `${g.hits.slice(0, 3).join("·")} (이 분류 수요의 ${Math.round(share * 100)}%)` });
    }
  }
  for (const [k, [n, why]] of Object.entries(SOCAR_MIN)) {
    const cur = grpSafe.get(k);
    if (groups.has(k) && (!cur || cur.n < n)) grpSafe.set(k, { n, why: `${why} — 쏘카 지정 정비` });
  }

  /* ── 시트 ── */
  const HDR = ["품번", "적용 차종 · 품명", "현재 재고", "제안 안전재고", "부족분", "상태", "매입가", "근거·비고"];
  const sheets: Record<string, (string | number)[][]> = {
    배터리: [], 오일필터: [], 에어컨필터: [], 에어필터: [], 브레이크패드: [],
  };
  const stat = new Map<string, { rows: number; qty: number; safe: number; lack: number; cost: number }>();
  const bump = (c: string, q: number, s: number, l: number, cost: number) => {
    const st = stat.get(c) ?? { rows: 0, qty: 0, safe: 0, lack: 0, cost: 0 };
    st.rows++; st.qty += q; st.safe += s; st.lack += l; st.cost += cost;
    stat.set(c, st);
  };
  const shown = new Set<string>();

  for (const g of groups.values()) {
    const gs = grpSafe.get(g.key);
    if (!gs && g.qty === 0) continue;
    const safe = gs?.n ?? 0;
    /** 대표 = 이미 갖고 있는 것 → 없으면 가장 싼 것 (순정보다 일반이 싸다) */
    const rep =
      g.members.find((m) => have(m) > 0) ??
      [...g.members].sort((a, b) => (a.price || 9e9) - (b.price || 9e9))[0];
    for (const m of g.members) {
      const q = have(m);
      shown.add(m.no.toUpperCase());
      if (m.suffix) shown.add(m.suffix.toUpperCase());
      const isRep = m.no === rep.no;
      if (!isRep && q === 0 && safe === 0) continue;
      const mySafe = isRep ? safe : 0;
      const lack = Math.max(0, mySafe - q);
      const state = lack > 0 ? "🔴 부족" : mySafe === 0 ? (q > 0 ? "여유" : "주문 대응") : q > mySafe * 3 ? "과잉" : "적정";
      sheets[g.cat].push([
        m.no,
        (m.position ? `[${m.position}] ` : "") + m.name.slice(0, 58),
        q, mySafe, lack > 0 ? lack : "", state,
        m.price > 0 ? m.price : "",
        isRep
          ? (gs?.why ?? "상비 대상 아님 — 재고 소진 후 주문 (익일 배송)")
          : `같은 자리 — 대표 ${rep.no} 로 상비 (${/MOBIS/.test(m.no) ? "순정" : /-C\d/.test(m.no) ? "활성탄" : "다른 브랜드"})`,
      ]);
      bump(g.cat, q, mySafe, lack, lack * m.price);
    }
  }

  /* 카탈로그에 없는 기존 재고도 싣는다 (패드의 옛 SM·FP 코드 등) */
  for (const r of dbRows) {
    if (r.qty <= 0 || shown.has(r.part_no.toUpperCase())) continue;
    const cat = r.category as Cat;
    if (!sheets[cat]) continue;
    sheets[cat].push([
      r.part_no, r.name.slice(0, 58), r.qty, 0, "", "기존 재고", "",
      "부품몰 카탈로그에 없는 기존 재고 — 소진 후 같은 자리 품번으로 대체",
    ]);
    bump(cat, r.qty, 0, 0, 0);
  }

  const bs = { rows: 0, qty: 0, safe: 0, lack: 0, cost: 0 };
  for (const [no, bought] of Object.entries(BATT)) {
    const q = stock.get(no.toUpperCase()) ?? 0;
    const safe = battSafe(no, bought);
    const lack = Math.max(0, safe - q);
    let why = `올해 매입 ${bought}개 (월 ${(bought / 7.5).toFixed(1)})`;
    if (/^LN2/.test(no)) why += " · 하이브리드 보조 AGM — 유입 증가";
    if (/HK62DL/.test(no)) why += " · 쏘카 아반떼CN7·셀토스";
    sheets["배터리"].push([no, "", q, safe, lack > 0 ? lack : "", lack > 0 ? "🔴 부족" : q > safe * 3 ? "과잉" : "적정", "", why]);
    bs.rows++; bs.qty += q; bs.safe += safe; bs.lack += lack;
  }
  for (const [no, bought, note] of BATT_MISSING) {
    sheets["배터리"].push([no, "(품목 미등록)", 0, 1, 1, "🔴 부족", "", `올해 매입 ${bought}개 · ${note}`]);
    bs.rows++; bs.safe += 1; bs.lack += 1;
  }
  stat.set("배터리", bs);

  for (const k of Object.keys(sheets)) {
    sheets[k].sort((a, b) => Number(b[4] || 0) - Number(a[4] || 0) || Number(b[3]) - Number(a[3]) || Number(b[2]) - Number(a[2]));
  }

  const wb = XLSX.utils.book_new();
  const order = ["배터리", "오일필터", "에어컨필터", "에어필터", "브레이크패드"] as const;
  const totalLack = order.reduce((s, k) => s + (stat.get(k)?.lack ?? 0), 0);
  const totalCost = order.reduce((s, k) => s + (stat.get(k)?.cost ?? 0), 0);
  const summary: (string | number)[][] = [
    ["타이어모어 속초점 — 부품 안전재고 제안 (2026-08-15)"],
    ["대상", "필터류(오일·에어·에어컨) + 배터리 + 브레이크패드 · 부품몰 전체 카탈로그 2,927종에서 산출 (와이퍼 제외)"],
    [],
    ["분류", "표 줄수", "현재 재고", "제안 안전재고", "지금 부족", "부족분 매입가", "월 수요(실측)"],
    ...order.map((k) => {
      const s = stat.get(k) ?? { rows: 0, qty: 0, safe: 0, lack: 0, cost: 0 };
      const note = k === "배터리" ? "월 33개 (매입 354 − 현재고 104 = 소비 250개 ÷ 7.5개월)" : PLAN[k as Cat].note;
      return [k, s.rows, s.qty, s.safe, s.lack, s.cost > 0 ? Math.round(s.cost) : "", note] as (string | number)[];
    }),
    ["합계", "", "", "", totalLack, Math.round(totalCost), "배터리 제외 금액"],
    [],
    ["산출 방법", "① 분류별 월 수요를 실측하고 ② 차종 가중치로 나눠 가진 뒤 ③ 상위 품목만 2~3개월분 넉넉히 상비. 나머지는 주문 대응(부품몰 익일 배송)"],
    ["같은 자리 묶음", "순정(_MOBIS)·활성탄(C)·브랜드(SM/SP) 차이는 한 묶음으로 보고 **대표 하나만** 상비합니다 — 따로 세면 두 배로 사게 됩니다"],
    [],
    ["근거 ① 입차 내역(실측)", "MARS 완료 송장 2026년 2,040건 = 월 285건. 앱 공임 기록은 못 씁니다 — 올해 판매 3,282건 중 3,112건이 「MARS 정비 이관(품목 내역 없음)」이라 품목이 남은 건 5%뿐입니다"],
    ["", "쏘카 오더 194건(월 26건): 엔진오일 63 · 에어컨필터 63 · 배터리 28 — 신차라도 우리 매장에서 정비하므로 별도 최소치"],
    ["", "배터리 매입 실적 354개(월 47) — 돈이 실제로 나간 가장 확실한 신호"],
    ["근거 ② 차종 가중치(실측)", "2026년 입차 계열별: 포터·봉고 213 · 제네시스 119 · 그랜저 112 · 싼타페 98 · 쏘나타 93 · 아반떼 82 · 르노 79 · 카니발 79 · 스타렉스·스타리아 78 · 모닝 74 · 쏘렌토 73 · 투싼 67 · 쌍용 65 · 전기차 50 · 스포티지 50 · K5 47 · 레이 44 · 쉐보레 40 (여기에 쏘카 오더를 더함)"],
    ["근거 ③ 정비 생태계", "일반보증 3년/6만·파워트레인 5년/10만 → 신차는 보증·쿠폰 기간에 블루핸즈/오토큐로 갑니다. 다만 입차를 보니 제네시스가 119건(3위)이나 옵니다 — 구형 G80(DH)·BH 는 보증이 끝나 우리 손님입니다. 그래서 하향은 신형(GV70·GV80·RG3·RS4) 전용 부품만 했습니다"],
    ["근거 ④ 시장", "쏘렌토 1위·SUV 강세·하이브리드 급증(보조 AGM↑)·EV 확대(오일필터↓·에어컨필터 유지)"],
    [],
    ["읽는 법", "「🔴 부족」 줄이 이번에 채울 것 · 「과잉」은 당분간 안 사도 됨 · 「여유」는 상비 대상은 아닌데 재고가 있는 것 · 「같은 자리」는 대표 품번으로만 사시면 됩니다"],
    ["가정 (고치기 쉬움)", "부품 소비 기록이 앱에도 부품몰 발주에도 없어, 오일교환 월 30건 · 에어컨필터 20건 · 에어필터 12건 · 패드 6건으로 잡았습니다 (쏘카 실측 8.4/8.4 + 일반 손님 추정). 실제로 한 달에 몇 건 하시는지만 알려주시면 그 자리에서 다시 뽑습니다"],
    ["확실한 것", "배터리는 매입 명세가 있어 정확합니다 — 354개 사서 104개 남았으니 250개 소비 = 월 33개"],
  ];
  const wsS = XLSX.utils.aoa_to_sheet(summary);
  wsS["!cols"] = [{ wch: 16 }, { wch: 122 }, { wch: 13 }, { wch: 14 }, { wch: 11 }, { wch: 14 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, wsS, "요약");
  for (const k of order) {
    const ws = XLSX.utils.aoa_to_sheet([HDR, ...sheets[k]]);
    ws["!cols"] = [{ wch: 20 }, { wch: 58 }, { wch: 9 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 52 }];
    XLSX.utils.book_append_sheet(wb, ws, k);
  }
  XLSX.writeFile(wb, OUT);
  console.log(`✅ 저장: ${OUT}`);
  for (const k of order) {
    const s = stat.get(k)!;
    console.log(`  ${k}: ${s.rows}줄 · 재고 ${s.qty} · 제안 ${s.safe} · 부족 ${s.lack}${s.cost ? ` (${Math.round(s.cost).toLocaleString()}원)` : ""}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
