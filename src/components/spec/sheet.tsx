/**
 * 순정 제원 한 장 — 그리기만 한다 (2026-09-05, 사장님 지시)
 *
 * 「가독성이 떨어지고 한눈에 들어오질 않음. 간단하게 내가 원하는 내용들이 한눈에 보였으면 좋겠음.」
 *
 * 🔴 **`"use client"` 를 붙이지 않는다.** 서버 화면(`vehicle/[id]`)과
 *    클라이언트 화면(`settings/spec`·`carinfo`)이 **같은 부품**을 써야 세 곳이 안 갈라진다.
 *    그래서 훅을 쓰지 않고, 버튼은 `actions` 로 바깥에서 꽂는다.
 *
 * 🔴 **숫자를 여기서 만들지 않는다.** `hidden`·`locked` 값은 자물쇠 문구만 그린다.
 *    은폐 판정은 `spec.ts` 의 `shownValue()` 한 곳에만 있어야 한다.
 */
import { ExternalLink, ShieldAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { StatusPill } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { shortQualifier } from "@/lib/spec-sheet-core";
import type { SheetLine, SheetSet, SheetTopic, SpecSheet, TopicKey } from "@/lib/spec-sheet-core";

const CARD = "rounded-card border border-slate-200 bg-white p-4";

export interface SheetActions {
  /** 주제(또는 벌) 하나에 붙일 단추 — 검수 화면만 넘긴다 */
  (arg: { topic: TopicKey; groupNo: number; waitingIds: number[]; autoIds: number[] }): ReactNode;
}

export function SpecSheetView({
  sheet,
  actions,
  onEngine,
}: {
  sheet: SpecSheet;
  actions?: SheetActions;
  /** 엔진 고르기 단추를 그릴 때 쓸 링크 만들기 (없으면 안 그린다) */
  onEngine?: (engine: string | null) => string;
}) {
  return (
    <div className="mt-3 space-y-3">
      {sheet.engines.length >= 2 && onEngine ? <EnginePicker sheet={sheet} onEngine={onEngine} /> : null}
      {sheet.topics.map((t) => (
        <TopicCard key={t.key} topic={t} setCount={sheet.setCount} actions={actions} />
      ))}
      {sheet.topics.length === 0 ? (
        <p className={`${CARD} text-sm text-slate-500`}>아직 이 차종의 제원이 없습니다.</p>
      ) : null}
    </div>
  );
}

/**
 * 🔴 엔진을 고르시기 전에는 **부품을 하나로 좁히지 않는다.**
 *    엔진을 모르면서 오일필터 하나를 골라 드리면 사장님은 그게 맞는 줄 아시고 끼우신다.
 */
function EnginePicker({ sheet, onEngine }: { sheet: SpecSheet; onEngine: (e: string | null) => string }) {
  return (
    <div className={CARD}>
      <p className="text-xs font-semibold text-slate-500">엔진</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <a
          href={onEngine(null)}
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            sheet.engine === null ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
          }`}
        >
          전부
        </a>
        {sheet.engines.map((e) => (
          <a
            key={e}
            href={onEngine(e)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              sheet.engine === e ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {e}
          </a>
        ))}
      </div>
      {sheet.engine === null ? (
        <p className="mt-2 text-xs leading-snug text-slate-500">
          엔진을 고르시면 그 엔진 부품만 보여 드립니다. 고르기 전에는 <b>후보를 다 보여 드립니다</b>.
        </p>
      ) : null}
    </div>
  );
}

function TopicCard({
  topic,
  setCount,
  actions,
}: {
  topic: SheetTopic;
  setCount: number;
  actions?: SheetActions;
}) {
  const waiting = topic.waitingIds.length;
  const 벌여럿 = topic.perSet && setCount >= 2;

  return (
    <section className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">{topic.title}</h3>
        <TopicBadge topic={topic} />
      </div>

      {벌여럿 ? (
        <Notice tone="warn">
          이 차종은 휠이 <b>{setCount}벌</b>입니다 — 손님 차에 붙은 인치를 보고 골라 주세요.
        </Notice>
      ) : null}

      {topic.conflictIds.length > 0 ? (
        <Notice tone="warn">값이 서로 어긋납니다. 아래 원문을 보고 맞는 쪽을 골라 주세요.</Notice>
      ) : null}

      {topic.sets.map((s, i) => (
        <SetBlock key={s.groupNo} set={s} showTitle={벌여럿} first={i === 0} topic={topic} actions={actions} />
      ))}

      {topic.needsPick ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-snug text-amber-700">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>어느 엔진 것인지 자료에 안 적힌 부품이 있습니다 — 품번을 확인하고 쓰세요.</span>
        </p>
      ) : null}

      {topic.moreParts > 0 ? (
        <p className="mt-1 text-xs text-slate-400">그 밖에 부품 {topic.moreParts}개가 더 있습니다.</p>
      ) : null}

      {topic.quotes.length > 0 || topic.sources.length > 0 ? <Evidence topic={topic} /> : null}
    </section>
  );
}

function TopicBadge({ topic }: { topic: SheetTopic }) {
  if (topic.origin === "부품") return <StatusPill tone="info">우리 부품</StatusPill>;
  if (topic.waitingIds.length > 0) return <StatusPill tone="accent">검수 {topic.waitingIds.length}</StatusPill>;
  /* 🔴 「사장님 확인」과 「자동 확인」은 절대 같아 보이면 안 된다 */
  if (topic.approved > 0 && topic.autoIds.length === 0) return <StatusPill tone="success">사장님 확인</StatusPill>;
  if (topic.autoIds.length > 0) return <StatusPill tone="neutral">자동 확인</StatusPill>;
  return null;
}

function SetBlock({
  set,
  showTitle,
  first,
  topic,
  actions,
}: {
  set: SheetSet;
  showTitle: boolean;
  first: boolean;
  topic: SheetTopic;
  actions?: SheetActions;
}) {
  return (
    <div className={first ? "mt-2" : "mt-3 border-t border-slate-100 pt-3"}>
      {showTitle && set.title ? <p className="text-[15px] font-bold text-slate-800">{set.title}</p> : null}
      <dl className="mt-1 divide-y divide-slate-50">
        {set.lines.map((l, i) => (
          <Line key={`${l.kind}-${l.item}-${i}`} line={l} />
        ))}
      </dl>
      {actions ? (
        <div className="mt-2">
          {actions({
            topic: topic.key,
            groupNo: set.groupNo,
            waitingIds: set.waitingIds,
            autoIds: set.autoIds,
          })}
        </div>
      ) : null}
    </div>
  );
}

function Line({ line }: { line: SheetLine }) {
  if (line.kind === "없음") {
    return (
      <div className="flex items-baseline justify-between gap-3 py-1.5">
        <dt className="shrink-0 text-sm text-slate-400">{line.label}</dt>
        <dd className="text-sm text-slate-400">자료 없음</dd>
      </div>
    );
  }

  if (line.kind === "부품" && line.part) {
    const p = line.part;
    const cond = [p.engine, p.axle, p.inch === null ? null : `${p.inch}인치`].filter(Boolean).join(" · ");
    return (
      <div className="py-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-sm text-slate-500">{line.label}</dt>
          <dd className="text-right text-sm font-semibold text-slate-900">
            {p.oemNos.length ? (
              <span className="font-mono">{p.oemNos.join(" / ")}</span>
            ) : (
              <span className="font-normal text-slate-400">품번 없음</span>
            )}
          </dd>
        </div>
        <p className="mt-0.5 flex flex-wrap items-center justify-end gap-x-2 text-right text-xs text-slate-500">
          {/* 🔴 좁힌 뒤에도 조건을 계속 붙여 둔다 — 잘못 고르셨을 때 눈에 걸려야 한다 */}
          {cond ? <span className="font-medium text-slate-600">{cond}</span> : <span className="text-amber-700">조건 미상</span>}
          {p.stock > 0 ? <span className="text-brand-700">재고 {p.stock}</span> : null}
          {p.listPrice ? <span>{p.listPrice.toLocaleString()}원</span> : null}
        </p>
        <p className="mt-0.5 truncate text-right text-[11px] text-slate-400" title={p.why}>
          {p.why}
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-sm text-slate-500">{line.label}</dt>
      <dd className="text-right">
        {line.values.map((v, i) => (
          <span key={i} className="ml-2 inline-block">
            {/* 🔴 조건표는 짧게 보여 주되 원래 글자는 title 로 남긴다 —
                「디젤 엔진 스마트스트림 D2.2」가 값 앞에 다 붙으면 값이 안 보인다 */}
            {v.qualifier ? (
              <span className="mr-1 text-xs text-slate-400" title={v.qualifier}>
                {shortQualifier(v.qualifier)}
              </span>
            ) : null}
            {v.hidden || v.locked || v.shown === null ? (
              <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                <ShieldAlert className="size-3.5" />
                {v.locked ? "차종을 확인하시면 보여드립니다" : "확인 전에는 숫자를 보여드리지 않습니다"}
              </span>
            ) : (
              <span
                className={`text-sm font-semibold ${
                  v.status === "승인" ? "text-slate-900" : v.status === "자동확인" ? "text-slate-700" : "text-slate-500"
                }`}
              >
                {v.shown}
                {v.status === "자동확인" ? <span className="ml-1 text-[11px] font-normal text-slate-400">자동</span> : null}
              </span>
            )}
          </span>
        ))}
        {line.conflict ? <span className="ml-1 text-xs font-semibold text-amber-700">← 어긋남</span> : null}
      </dd>
    </div>
  );
}

/**
 * 원문·출처는 접는다.
 * 🔴 예전 화면은 원문을 늘 펼쳐 두었다. 그 규칙은 **검수 중인 값**을 지키려던 것이라
 *    검수 대기가 있으면 여전히 펼쳐 둔다. 자동확인만 있으면 접는 것이 사장님이 원하신 화면이다.
 */
function Evidence({ topic }: { topic: SheetTopic }) {
  return (
    <details className="mt-2" open={topic.waitingIds.length > 0}>
      <summary className="cursor-pointer text-xs text-slate-500">
        근거·출처 {topic.sources.length}곳
      </summary>
      {topic.quotes.length > 0 ? (
        <div className="mt-1.5 space-y-1">
          {topic.quotes.map((q, i) => (
            <p key={i} className="rounded-control bg-slate-50 p-2 font-mono text-[11px] leading-snug text-slate-600">
              {q}
            </p>
          ))}
        </div>
      ) : null}
      <ul className="mt-1.5 space-y-0.5">
        {topic.sources.map((s) => (
          <li key={s.url} className="text-[11px] text-slate-500">
            <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
              {s.title || s.url}
              <ExternalLink className="size-3" />
            </a>
            <span className="ml-1 text-slate-400">{s.fetchedOn} 에 읽음</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
