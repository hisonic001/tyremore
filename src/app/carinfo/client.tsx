"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, PackageSearch, Search, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { Notice } from "@/components/ui/notice";
import type { FitPart } from "@/lib/parts-fit";
import type { VehicleSpecBlock } from "@/lib/spec";
import type { VinInfo } from "@/lib/vin";
import type { VinGuess } from "@/lib/vin-learn";
import type { AgentStatus } from "@/lib/blog-job";
import { PhotoRead } from "./photo-read";

/**
 * 정비 조회 — 차대번호를 넣고, 차종을 확인하고, 규격과 부품을 본다 (2026-09-04)
 *
 * 🔴 화면의 규칙 하나: **「차대번호로 추정한 차종」과 「사장님이 맞다고 한 차종」을
 *    절대 같아 보이게 두지 않는다.** 추정 상태에서는 휠너트 토크·오일 용량 숫자가
 *    아예 안 온다 (서버에서 빠진다). 세대를 잘못 짚으면 다른 차 토크가 뜨기 때문이다.
 */
export function CarLookup({
  vinText,
  vin,
  guess,
  confirmed,
  spec,
  parts,
  gens,
  agent,
}: {
  vinText: string;
  vin: VinInfo | null;
  guess: VinGuess | null;
  confirmed: boolean;
  spec: VehicleSpecBlock | null;
  parts: FitPart[];
  gens: { variantKey: string; label: string }[];
  agent: AgentStatus;
}) {
  const router = useRouter();
  const [q, setQ] = useState(vinText);

  const go = (next: Record<string, string | null>) => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("vin", q.trim());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    router.push(`/carinfo?${p.toString()}`);
  };

  return (
    <>
      {/* ── 차대번호 넣기 ── */}
      <div className="mt-3 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go({ gen: null, ok: null });
          }}
          placeholder="차대번호 17자리 (등록증에 적힌 대로)"
          inputMode="text"
          autoCapitalize="characters"
          spellCheck={false}
          className="tabular min-h-11 flex-1 rounded-control border border-slate-300 px-3 text-[15px] tracking-wide uppercase"
        />
        <Button onClick={() => go({ gen: null, ok: null })}>
          <Search className="size-4" /> 조회
        </Button>
      </div>

      {/*
        ⭐ 사진으로 읽기 (2026-09-05) — 17자리를 손으로 치지 않아도 된다.
        🔴 읽은 값은 **자동으로 안 들어간다.** 사장님이 「이 차대번호로 조회」를 누르셔야 간다.
      */}
      <PhotoRead
        agent={agent}
        onVin={(v) => {
          setQ(v);
          const p = new URLSearchParams();
          p.set("vin", v);
          router.push(`/carinfo?${p.toString()}`);
        }}
      />

      {vin && (
        <>
          {vin.problems.length > 0 && (
            <Notice tone="warn">
              {vin.problems.map((p) => (
                <span key={p} className="block">
                  {p}
                </span>
              ))}
            </Notice>
          )}

          {/* ── 차대번호로 확실히 알 수 있는 것 ── */}
          <section className="mt-3 rounded-card border border-slate-200 bg-white p-4">
            <h2 className="text-[15px] font-bold text-slate-900">차대번호에서 읽은 것</h2>
            <dl className="mt-2 divide-y divide-slate-100">
              <Row label="제조사" value={vin.maker ?? "모름"} />
              <Row label="생산국" value={vin.country ?? "모름"} />
              <Row label="연식" value={vin.year ? `${vin.year}년형` : "모름"} />
              <Row label="일련번호 (뒤 6자리)" value={vin.serial} />
            </dl>
            <p className="mt-2 text-[11px] leading-snug text-slate-400">
              여기까지는 국제 규격이라 확실합니다. <strong>차종은 차대번호로 알 수 없습니다</strong> —
              4~9번째 자리의 뜻은 제작사가 공단에 따로 제출하는 비공개 자료입니다.
            </p>
          </section>

          {/* ── 차종 정하기 ── */}
          <section className="mt-4 rounded-card border border-slate-200 bg-white p-4">
            <h2 className="text-[15px] font-bold text-slate-900">차종</h2>

            {spec ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-semibold text-slate-900">{spec.label}</span>
                {confirmed ? (
                  <StatusPill tone="success">확인됨</StatusPill>
                ) : (
                  <StatusPill tone="warn">차대번호로 추정</StatusPill>
                )}
                {guess && !confirmed && (
                  <span className="text-[12px] text-slate-500">같은 차대번호 앞자리 {guess.support}대에서 배움</span>
                )}
              </div>
            ) : (
              <p className="mt-2 text-[13px] text-slate-500">
                차대번호로는 차종을 못 정했습니다. 아래에서 골라 주세요.
              </p>
            )}

            {spec && !confirmed && (
              <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
                <p className="text-[13px] leading-snug text-amber-900">
                  <strong>이 차가 「{spec.label}」이 맞습니까?</strong> 맞다고 눌러 주셔야 휠너트 토크·오일 용량
                  숫자를 보여드립니다 — 차종이 틀리면 <strong>다른 차의 토크</strong>가 뜨기 때문입니다.
                </p>
                <div className="mt-2">
                  <Button onClick={() => go({ ok: "1" })}>
                    <Check className="size-4" /> 맞습니다
                  </Button>
                </div>
              </div>
            )}

            <label className="mt-3 block text-[13px] text-slate-600">
              직접 고르기
              <select
                defaultValue={spec?.variantKey ?? ""}
                onChange={(e) => e.target.value && go({ gen: e.target.value, ok: null })}
                className="mt-1 block min-h-11 w-full rounded-control border border-slate-300 bg-white px-3 text-[15px]"
              >
                <option value="">— 차종 고르기 —</option>
                {gens.map((g) => (
                  <option key={g.variantKey} value={g.variantKey}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
          </section>
        </>
      )}

      {!vinText && (
        <EmptyState
          emoji="🔎"
          title="차대번호를 넣어 주세요"
          hint="등록증이나 앞유리 아래에 적힌 영문·숫자 17자리입니다. 우리 손님 차는 홈에서 번호판으로 찾으시면 더 빠릅니다."
        />
      )}

      {/* ── 순정 규격 ── */}
      {spec && <SpecCard spec={spec} confirmed={confirmed} />}

      {/* ── 이 차에 맞는 부품 ── */}
      {spec && <PartsCard parts={parts} />}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-[13px] text-slate-500">{label}</dt>
      <dd className="tabular text-right text-[15px] font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function SpecCard({
  spec,
  confirmed,
}: {
  spec: VehicleSpecBlock & { generationId: number };
  confirmed: boolean;
}) {
  return (
    <section className="mt-4 rounded-card border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-bold text-slate-900">순정 규격</h2>
        {spec.manualUrl && (
          <a
            href={spec.manualUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[12px] text-sky-700 underline underline-offset-4"
          >
            제조사 설명서 <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      {spec.groups.length === 0 ? (
        <p className="mt-2 text-[13px] text-slate-500">
          {spec.waiting > 0
            ? `설명서에서 받아 온 값 ${spec.waiting}개가 아직 검수 전입니다 — 설정 → 차종별 순정 제원에서 확인하시면 열립니다.`
            : "이 차종은 아직 제원을 못 받아 왔습니다."}
        </p>
      ) : (
        spec.groups.map((g, i) => (
          <div key={g.groupLabel ?? i} className="mt-3">
            {g.groupLabel && <p className="text-[13px] font-semibold text-slate-700">{g.groupLabel}</p>}
            <dl className="mt-1 divide-y divide-slate-100">
              {g.rows.map((r, j) => (
                <div key={`${r.label}-${j}`} className="flex items-baseline justify-between gap-3 py-1.5">
                  <dt className="shrink-0 text-[13px] text-slate-500">
                    {r.label}
                    {r.qualifier && <span className="ml-1 text-slate-400">{r.qualifier}</span>}
                  </dt>
                  <dd
                    className={`tabular text-right text-[15px] font-semibold ${
                      r.shown.startsWith("차종을 확인") ? "text-amber-700" : "text-slate-900"
                    }`}
                  >
                    {r.shown.startsWith("차종을 확인") ? (
                      <span className="inline-flex items-center gap-1 text-[13px]">
                        <ShieldAlert className="size-3.5" /> {r.shown}
                      </span>
                    ) : (
                      r.shown
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))
      )}

      <p className="mt-3 text-[11px] text-slate-400">
        와이퍼 규격 — <strong>자료 없음</strong> (취급설명서에 안 실립니다)
        {!confirmed && " · 차종을 확인하시면 가려진 값이 열립니다"}
      </p>
    </section>
  );
}

function PartsCard({ parts }: { parts: FitPart[] }) {
  const byCat = new Map<string, FitPart[]>();
  for (const p of parts) {
    const k = p.category ?? "기타";
    byCat.set(k, [...(byCat.get(k) ?? []), p]);
  }
  return (
    <section className="mt-4 rounded-card border border-slate-200 bg-white p-4">
      <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-slate-900">
        <PackageSearch className="size-4 text-slate-400" /> 이 차에 맞는 부품
      </h2>
      {parts.length === 0 ? (
        <p className="mt-2 text-[13px] text-slate-500">
          우리 상품 목록에 이 차종이 적힌 부품이 없습니다. (적용 차종 글자에 차종 코드가 있는 것만 보여줍니다)
        </p>
      ) : (
        [...byCat.entries()].map(([cat, list]) => (
          <div key={cat} className="mt-3">
            <p className="text-[13px] font-semibold text-slate-700">{cat}</p>
            <ul className="mt-1 divide-y divide-slate-100">
              {list.map((p) => (
                <li key={p.productId} className="py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-[14px] text-slate-900">{p.name}</span>
                    <span className="tabular shrink-0 text-[13px] text-slate-500">
                      {p.stock > 0 ? (
                        <strong className="text-brand-700">재고 {p.stock}</strong>
                      ) : (
                        <span className="text-slate-400">재고 없음</span>
                      )}
                      {p.listPrice ? ` · ${p.listPrice.toLocaleString()}원` : ""}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
                    {p.partNo && <span className="tabular mr-1 text-slate-500">{p.partNo}</span>}
                    {p.why}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      <p className="mt-3 text-[11px] leading-snug text-slate-400">
        회색 글자는 <strong>왜 이 부품이 걸렸는지</strong> 상품의 적용 차종에서 그대로 옮긴 것입니다 —
        눈으로 한 번 확인하고 쓰십시오. 틀린 품번은 없는 것보다 나쁩니다.
      </p>
    </section>
  );
}
