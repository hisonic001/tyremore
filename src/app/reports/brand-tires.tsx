"use client";
/**
 * ⭐ 브랜드별 타이어 본수 — 막대 클릭 드릴다운 (사장님 요청 2026-09-04)
 *
 *   "브랜드별 그래프 클릭시 어떤 타이어를 몇개 팔았는지 나왔으면 좋겠음."
 *
 *   자료는 서버에서 전부 만들어 내려보내고 (이번 달 팔린 모델 몇십 줄뿐이다),
 *   여기는 「어느 막대를 눌렀나」만 들고 있다 — 누르는 즉시 바뀌고 통신이 없다.
 *   처음에는 제일 많이 판 브랜드가 펼쳐져 있다 (빈 화면으로 시작하지 않는다).
 */
import { useState } from "react";
import { ColumnChart } from "./charts";
import { BarList } from "./ui";

export interface BrandTireRow {
  /** 브랜드 이름 (한글 정식) */
  brand: string;
  /** 축 라벨용 짧은 이름 */
  short: string;
  /** 이번 달 본수 */
  mq: number;
  /** 올해 누적 본수 */
  yq: number;
  /** 이번 달 팔린 모델들 — 본수 내림차순 */
  models: { name: string; mq: number; yq: number }[];
}

export function BrandTires({ rows }: { rows: BrandTireRow[] }) {
  const [sel, setSel] = useState(0);
  const cur = rows[sel];

  return (
    <div>
      <ColumnChart
        data={rows.map((r, i) => ({
          label: r.short,
          value: r.mq,
          hint: `${r.brand} · 이번 달 ${r.mq}본 · 올해 ${r.yq}본`,
          hot: i === sel,
        }))}
        height={170}
        unit="본"
        onBarClick={setSel}
      />
      {cur && (
        <div className="mt-3 rounded-control bg-slate-50 p-3">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold">{cur.brand}</span>
            <span className="tabular text-xs text-slate-500">
              이번 달 {cur.mq}본 · 올해 {cur.yq}본
            </span>
          </div>
          <div className="mt-2">
            <BarList
              rows={cur.models.map((m) => ({
                key: m.name,
                label: m.name,
                note: m.yq > m.mq ? `올해 ${m.yq}본 · ` : "",
                value: `${m.mq}본`,
                weight: m.mq,
              }))}
            />
          </div>
          <p className="mt-2 text-[11px] text-slate-400">다른 브랜드 막대를 누르면 그 브랜드로 바뀝니다</p>
        </div>
      )}
    </div>
  );
}
