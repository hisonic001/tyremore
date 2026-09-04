/**
 * ⭐ 서버에서 그리는 SVG 차트 (2026-08-06, 매출 리포트)
 *
 * 차트 라이브러리를 넣지 않는다 — 월별·일별 막대와 구성비 막대가 전부라
 * SVG 몇 십 줄이면 되고, 클라이언트 JS 가 0 이라 폰에서도 즉시 뜬다.
 *
 * 색은 검증기를 통과한 팔레트만 쓴다 (라이트 전용 — 앱에 다크모드 없음):
 *   단일 계열(막대)  브랜드 그린 #009944 · 강조 #00722f (2026-09-03 리프레시 —
 *   "색은 브랜드 그린+슬레이트로 제한" — 단일 색상 계열이라 색약 안전)
 *   구성비(결제수단) #2a78d6 / #eb6834 / #1baf7a — 3색 전 쌍 색약 검사 통과.
 *     #1baf7a 는 흰 바탕 대비가 3:1 미만이라 **범례에 금액·비율을 반드시 병기**한다.
 * 값 라벨은 최대·강조 막대에만 단다(전부 달면 그래프가 표가 된다).
 * 마우스를 올리면 <title> 이 브라우저 기본 풍선으로 상세를 보여준다.
 */

export type Bar = {
  label: string; // 축 라벨. 빈 문자열이면 생략 (일별 31칸은 5일 간격만)
  value: number;
  hint: string; // <title> — "12월 · 391건 · 1.2억원"
  hot?: boolean; // 강조 (보고 있는 달)
};

/** 돈을 짧게 — 축·막대 라벨용 (1.2억 · 8,063만) */
export function fmtShort(n: number): string {
  if (n >= 1e8) {
    const v = n / 1e8;
    return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}억`;
  }
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString("ko-KR")}만`;
  return n.toLocaleString("ko-KR");
}

export function fmtWon(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

/** 눈금 최대값을 보기 좋은 수로 올림 (1·1.5·2·2.5·3·4·5·6·8 × 10ⁿ) */
function niceCeil(v: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (m * pow >= v) return m * pow;
  }
  return 10 * pow;
}

/** 위쪽만 둥근 막대 (아래는 기준선에 붙는다) */
function barPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export function ColumnChart({
  data,
  height = 180,
  color = "#009944",
  hotColor = "#00722f",
  unit = "",
  onBarClick,
}: {
  data: Bar[];
  height?: number;
  color?: string;
  hotColor?: string;
  /** 값 라벨 뒤에 붙일 단위 — 본수 차트는 "본" (2026-09-03) */
  unit?: string;
  /**
   * ⭐ 막대 클릭 (2026-09-04, 브랜드 드릴다운) — 클라이언트 부품에서 쓸 때만
   *    넘긴다. 서버 페이지에서는 함수를 못 넘기므로 저절로 기존 그대로다.
   */
  onBarClick?: (index: number) => void;
}) {
  const W = 700;
  const PL = 6;
  const PR = 6;
  const PT = 22;
  const PB = 20;
  const innerW = W - PL - PR;
  const innerH = height - PT - PB;
  const max = niceCeil(Math.max(1, ...data.map((d) => d.value)));
  const slot = innerW / data.length;
  const bw = Math.max(3, Math.min(slot - 2, 44));
  const maxIdx = data.reduce((bi, d, i, a) => (d.value > a[bi].value ? i : bi), 0);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img">
      {/* 눈금 — 절반·최대 두 줄이면 규모가 읽힌다 */}
      {[0.5, 1].map((f) => {
        const y = PT + innerH * (1 - f);
        return (
          <g key={f}>
            <line x1={PL} x2={W - PR} y1={y} y2={y} stroke="#e1e0d9" strokeWidth="1" />
            <text x={PL} y={y - 4} fontSize="10" fill="#898781">
              {fmtShort(max * f)}{unit}
            </text>
          </g>
        );
      })}
      <line x1={PL} x2={W - PR} y1={PT + innerH} y2={PT + innerH} stroke="#c3c2b7" strokeWidth="1" />

      {data.map((d, i) => {
        const h = Math.round((d.value / max) * innerH);
        const x = PL + slot * i + (slot - bw) / 2;
        const y = PT + innerH - h;
        const labeled = d.value > 0 && (d.hot || i === maxIdx);
        return (
          <g
            key={i}
            onClick={onBarClick ? () => onBarClick(i) : undefined}
            className={onBarClick ? "cursor-pointer" : undefined}
          >
            <title>{d.hint}</title>
            {/* 값이 0 이어도 마우스가 닿게 투명 판을 깐다 */}
            <rect x={PL + slot * i} y={PT} width={slot} height={innerH} fill="transparent" />
            {d.value > 0 && <path d={barPath(x, y, bw, h, 4)} fill={d.hot ? hotColor : color} />}
            {labeled && (
              <text x={x + bw / 2} y={y - 5} textAnchor="middle" fontSize="11" fontWeight="600" fill="#0b0b0b">
                {fmtShort(d.value)}{unit}
              </text>
            )}
            {d.label && (
              <text x={PL + slot * i + slot / 2} y={height - 6} textAnchor="middle" fontSize="10" fill="#898781">
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export type Segment = { label: string; value: number; color: string };

/** 구성비 한 줄 막대 — 조각 사이 2px 흰 틈, 양 끝 둥글게 */
export function StackedBar({ parts, clipId }: { parts: Segment[]; clipId: string }) {
  const W = 700;
  const H = 32;
  const total = parts.reduce((s, p) => s + p.value, 0);
  let x = 0;
  const segs = parts
    .filter((p) => p.value > 0)
    .map((p) => {
      const w = total ? (p.value / total) * W : 0;
      const seg = { ...p, x, w };
      x += w;
      return seg;
    });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      <defs>
        <clipPath id={clipId}>
          <rect width={W} height={H} rx="9" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width={W} height={H} fill="#f0efec" />
        {segs.map((s, i) => {
          const pct = total ? Math.round((s.value / total) * 100) : 0;
          return (
            <g key={s.label}>
              <title>{`${s.label} · ${fmtWon(s.value)} (${pct}%)`}</title>
              <rect x={s.x} y={0} width={Math.max(0, s.w - (i < segs.length - 1 ? 2 : 0))} height={H} fill={s.color} />
              {s.w >= 64 && (
                <text x={s.x + s.w / 2} y={H / 2 + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill="#ffffff">
                  {pct}%
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
