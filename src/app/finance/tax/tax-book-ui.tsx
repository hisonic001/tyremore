"use client";

/**
 * ⭐ 계산서 화면 (개편 2026-09-11, 사장님 결정 1~10 — 설계서 「계산서 화면 개편」)
 *
 *   상대별 한 줄 → 펼치면 그 상대의 계산서 카드(한 장 = 두 칸: 누구 → 돈).
 *   매입(빨강)·매출(초록) 한 화면. 사람이 누르는 건 [대사] [경비] [보류] [제외] 넷뿐.
 *   월정산 거래처는 장 단위로 안 보고 「계산서 합 · 준 돈 · 잔액」 한 줄(기준일 + 시작 잔액).
 *
 *   ⭐ 용어(2026-09-12, 사장님 "ERP 기준 명료한 단어"): 화면 글자는 fin-words 정본 —
 *      맞추기→대사, 맞춘 기록→대사 내역, 나중에→보류, 안 봄→제외, 서로 지움→상계.
 *      「앱이 자동 대사한 것」의 되돌리기는 「최근 한 일」 한 곳으로(결정 f) — 목록만 남김.
 *   🔴 데이터는 taxBook(ym) 하나(tax-book.ts 정본). 여기서는 새 판정을 만들지 않는다.
 *   🔴 서버 액션은 순차 호출(for … await) — DB 풀 max 3. Promise.all 금지.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import type { BankPick, InvoiceCard, Mark, MonthlySummary, PartyRow, TaxBook } from "@/lib/tax-book-types";
import {
  confirmBankToTaxes,
  confirmTaxToBank,
  confirmTaxToBanks,
  ignoreTaxInvoice,
  markTaxFixPair,
  markTaxWaiting,
  setTaxBaseline,
  setTaxPartyRule,
  undoTaxMatch,
} from "@/lib/recon";
import { useConfirm, type ConfirmOpts } from "@/components/ui/confirm";
import { Notice } from "@/components/ui/notice";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/badge";
import { won } from "@/components/fin/money";
import { W } from "@/lib/fin-words";
import { BankSearch, MultiPickBar, PickList, pickedSum, type Picked, type PickItem } from "./link-parts";

/* ───────────────────────── 공통 ───────────────────────── */

/** 액션 결과 — ok 면 msg 로 더 자세한 말을 넘길 수 있다(없으면 okText) */
type R = { ok: true; msg?: string } | { ok: false; error: string };
type NoteMap = Record<string, { tone: "success" | "error"; text: string }>;

/** 화면 전체가 같이 쓰는 손잡이 — 진행 상태·액션 실행·줄 밑 알림·확인 시트 */
interface Ctx {
  pending: boolean;
  /** key 아래에 결과를 적고 router.refresh() */
  act: (key: string, fn: () => Promise<R>, okText: string) => void;
  notes: NoteMap;
  ask: (opts: ConfirmOpts) => Promise<boolean>;
}

/** 표시 낱말은 뱃지(components/fin/badge.tsx)와 같은 벌 — 끝→대사 완료 · 확인→대사 후보 · 손 필요→미대사 · 기다림→보류 */
const MARK: Record<Mark, { icon: string; label: string; cls: string }> = {
  done: { icon: "✅", label: W.done, cls: "text-brand-700" },
  confirm: { icon: "🟡", label: W.candidate, cls: "text-amber-700" },
  hand: { icon: "✖", label: W.open, cls: "text-red-600" },
  wait: { icon: "⚪", label: W.hold, cls: "text-slate-400" },
};
const MARK_ORDER: Record<Mark, number> = { hand: 0, confirm: 1, wait: 2, done: 3 };

function MarkIcon({ mark, withLabel }: { mark: Mark; withLabel?: boolean }) {
  const m = MARK[mark];
  return (
    <span className={`shrink-0 ${m.cls}`} title={m.label} aria-label={m.label}>
      {m.icon}
      {withLabel && <span className="ml-1 text-xs font-medium">{m.label}</span>}
    </span>
  );
}

/** 매입=빨강 · 매출=초록 (사장님 결정 3 — 색으로만 구분) */
const dirCls = (d: "매입" | "매출") => (d === "매입" ? "text-red-600" : "text-brand-700");
function DirAmount({ direction, total }: { direction: "매입" | "매출"; total: number }) {
  return (
    <span className={`tabular font-bold ${dirCls(direction)}`}>
      {direction} {won(total)}
    </span>
  );
}

const STATUS_LABEL: Record<InvoiceCard["status"], string | null> = {
  normal: null,
  expense: "경비",
  waiting: W.hold,
  ignored: W.ignore,
  fixed: W.offset,
};

function kindLabel(p: PartyRow) {
  if (p.kind === "대행") return p.agencyFor ? `대행(→${p.agencyFor})` : "대행";
  return p.kind;
}
const KIND_TONE: Record<PartyRow["kind"], "info" | "reserve" | "neutral" | "success" | "warn"> = {
  월정산: "info",
  대행: "reserve",
  경비: "neutral",
  거래처: "success",
  개인: "neutral",
  무시: "neutral",
};

const monthOf = (ym: string) => Number(ym.slice(5, 7));
/** MM-DD 로 짧게 (YYYY-MM-DD 가 오면 자른다) */
const md = (d: string) => (d.length >= 10 ? d.slice(5) : d);

function NoteFor({ ctx, k }: { ctx: Ctx; k: string }) {
  const n = ctx.notes[k];
  if (!n) return null;
  return <Notice tone={n.tone}>{n.text}</Notice>;
}

/* ───────────────────────── 화면 ───────────────────────── */

export function TaxBookView({ book, ym }: { book: TaxBook; ym: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState<NoteMap>({});
  const [ask, confirmDialog] = useConfirm();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const act: Ctx["act"] = (key, fn, okText) =>
    start(async () => {
      setNotes((p) => {
        const n = { ...p };
        delete n[key];
        return n;
      });
      const r = await fn();
      if (!r.ok) return setNotes((p) => ({ ...p, [key]: { tone: "error", text: r.error } }));
      setNotes((p) => ({ ...p, [key]: { tone: "success", text: r.msg ?? okText } }));
      router.refresh();
    });
  const ctx: Ctx = { pending, act, notes, ask };

  // 정렬: ✖ 미대사 → 🟡 대사 후보 → ⚪ 보류 → ✅ 대사 완료, 같은 층은 금액 큰 순
  const parties = useMemo(
    () => [...book.parties].sort((a, b) => MARK_ORDER[a.mark] - MARK_ORDER[b.mark] || b.total - a.total),
    [book.parties],
  );
  // 확인 층 카드 — confirmIds 로 찾는다 (상대 정보도 같이)
  const confirmCards = useMemo(() => {
    const byId = new Map<number, { card: InvoiceCard; party: PartyRow }>();
    for (const p of book.parties) for (const c of p.cards) byId.set(c.id, { card: c, party: p });
    return book.confirmIds.map((id) => byId.get(id)).filter((x): x is { card: InvoiceCard; party: PartyRow } => !!x);
  }, [book.parties, book.confirmIds]);

  const m = monthOf(ym);

  return (
    <div className="mt-3">
      {/* ── 머리 ── */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold">
          계산서 {m}월 — 남은 곳 <span className="tabular">{book.counts.partiesOpen}</span> / 상대{" "}
          <span className="tabular">{parties.length}</span>곳
        </h2>
        <span className="text-xs text-slate-500">
          <span className="font-semibold text-red-600">● 매입</span> · <span className="font-semibold text-brand-700">● 매출</span>
          <span className="ml-2">
            {MARK.hand.icon} {MARK.hand.label} {book.counts.hand} · {MARK.confirm.icon} {MARK.confirm.label} {book.counts.confirm} ·{" "}
            {MARK.done.icon} {MARK.done.label} {book.counts.done}
          </span>
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        상대를 누르면 그 상대의 계산서가 펼쳐집니다. 한 장마다 <strong>누구</strong>(어느 거래처인지)와{" "}
        <strong>돈</strong>(통장에서 실제로 오갔는지) 두 칸입니다.
      </p>

      <AutoDoneList book={book} />

      {confirmCards.length > 0 && <ConfirmLayer items={confirmCards} ctx={ctx} />}

      {/* ── 상대 목록 ── */}
      <ul className="mt-4 divide-y divide-slate-100 rounded-card border border-slate-200 bg-white">
        {parties.length === 0 && <li className="p-6 text-center text-sm text-slate-500">이 달 계산서가 없습니다.</li>}
        {parties.map((p) => {
          const isOpen = !!open[p.key];
          return (
            <li key={p.key}>
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [p.key]: !o[p.key] }))}
                aria-expanded={isOpen}
                className="flex w-full items-start gap-2 px-3 py-3 text-left active:bg-slate-50 lg:hover:bg-slate-50"
              >
                <MarkIcon mark={p.mark} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate text-[15px] font-semibold">{p.name}</span>
                    <StatusPill tone={KIND_TONE[p.kind]}>{kindLabel(p)}</StatusPill>
                    {p.handN > 0 && <StatusPill tone="error">{MARK.hand.label} {p.handN}</StatusPill>}
                    {p.confirmN > 0 && <StatusPill tone="warn">{MARK.confirm.label} {p.confirmN}</StatusPill>}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-slate-600">{p.summary}</span>
                  {p.monthly && p.monthly.appGap !== null && p.monthly.appGap > 0 && (
                    <span className="mt-0.5 block text-[13px] leading-snug text-amber-800">
                      앱 입고 {won(p.monthly.appReceived ?? 0)} → 앱에 안 넣은 매입 {won(p.monthly.appGap)}
                    </span>
                  )}
                </span>
                <span className={`shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span>
              </button>
              {isOpen && (
                <div className="border-t border-dashed border-slate-200 bg-slate-50/60 px-3 pb-3 pt-2">
                  <NoteFor ctx={ctx} k={`p:${p.key}`} />
                  {p.monthly ? <MonthlyPanel party={p} s={p.monthly} ym={ym} ctx={ctx} /> : <CardList party={p} ctx={ctx} />}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* ── 기준일 전 ── */}
      {book.past.n > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-card border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          <span>
            기준일 전 정리 안 된 것 <strong className="tabular">{book.past.n}</strong>장 ·{" "}
            <span className="tabular">{won(book.past.amount)}</span>원 — 잔액 셈에는 안 들어가고, 원장에서 봅니다
          </span>
          <Link href={book.past.href} className="shrink-0 font-semibold text-brand-700 underline underline-offset-4">
            보기
          </Link>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}

/* ───────────────────────── 앱이 자동 대사한 것 ───────────────────────── */

/** 목록은 남기고(무엇을 자동으로 했는지 보는 곳), 줄마다 있던 되돌리기(undoTaxMatch·ignoreTaxInvoice(id,true))는
 *  2단계(2026-09-12)부터 「최근 한 일」 한 곳에서 한다 — 링크 한 줄. */
function AutoDoneList({ book }: { book: TaxBook }) {
  const { cards, expenseN } = book.autoDone;
  if (cards.length === 0 && expenseN === 0) return null;
  return (
    <details className="mt-3 rounded-card border border-slate-200 bg-white px-4 py-2 text-sm">
      <summary className="cursor-pointer select-none py-1 font-medium text-slate-700">
        {W.tierAuto} <span className="tabular">{cards.length}</span>장 · 경비 <span className="tabular">{expenseN}</span>장{" "}
        <span className="text-slate-400">— 펼쳐서 확인할 수 있어요</span>
      </summary>
      {cards.length === 0 ? (
        <p className="py-2 text-slate-500">카드가 없습니다.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {cards.map((c) => (
            <li key={c.id} className="py-2">
              <span className="block min-w-0 truncate text-xs">
                <span className="text-slate-500">{md(c.d)}</span> {c.who.text} · <DirAmount direction={c.direction} total={c.total} />
                <span className="ml-1 text-slate-500">
                  — {STATUS_LABEL[c.status] ?? c.money.text}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="py-1.5 text-xs text-slate-400">
        잘못 {W.recon}됐으면{" "}
        <Link href="/finance/activity" className="underline underline-offset-4">{W.activityUndoHere}</Link>
      </p>
    </details>
  );
}

/* ───────────────────────── 확인 층 (체크해서 한 번에) ───────────────────────── */

/** 카드 하나를 대사 후보대로 대사하는 계획 — 어떤 액션을 부를지 + 사람에게 보여 줄 한 줄 */
function planFor(c: InvoiceCard): { text: string; run: () => Promise<R>; dedupe?: string } | null {
  const mo = c.money;
  if (mo.fix) {
    const f = mo.fix;
    return { text: f.label, run: () => markTaxFixPair(c.id, f.originId), dedupe: `fix:${c.id}:${f.originId}` };
  }
  if (mo.fixFirst) {
    const f = mo.fixFirst;
    return { text: f.label, run: () => markTaxFixPair(f.minusId, c.id), dedupe: `fix:${f.minusId}:${c.id}` };
  }
  if (mo.bundle) {
    const b = mo.bundle;
    return { text: b.label, run: () => confirmBankToTaxes(b.cashTxnId, b.invoiceIds), dedupe: `bundle:${b.cashTxnId}` };
  }
  const sure = mo.picks.find((p) => p.sure);
  if (sure) return { text: pickText(sure), run: () => confirmTaxToBank(c.id, sure.cashTxnId) };
  if (mo.combo) {
    const co = mo.combo;
    return { text: co.label, run: () => confirmTaxToBanks(c.id, co.cashTxnIds) };
  }
  return null;
}

function pickText(p: BankPick) {
  const diff = p.diff === 0 ? "" : p.diff > 0 ? ` (+${won(p.diff)})` : ` (−${won(-p.diff)})`;
  return `${p.d} ${p.description} ${won(p.amount)}${diff} · ${p.why}`;
}

function ConfirmLayer({ items, ctx }: { items: { card: InvoiceCard; party: PartyRow }[]; ctx: Ctx }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const isOn = (id: number) => checked[id] !== false; // 기본 ON
  const rows = items.map((it) => ({ ...it, plan: planFor(it.card) })).filter((r) => r.plan !== null);
  const n = rows.filter((r) => isOn(r.card.id)).length;

  const runAll = () =>
    start(async () => {
      setResult(null);
      let done = 0;
      const errs: string[] = [];
      const seen = new Set<string>();
      // 🔴 순차 — 풀 max 3. 같은 묶음(통장 한 줄 = N장)·같은 상계 쌍은 한 번만 부른다.
      for (const r of rows) {
        if (!isOn(r.card.id) || !r.plan) continue;
        if (r.plan.dedupe) {
          if (seen.has(r.plan.dedupe)) {
            done += 1;
            continue;
          }
          seen.add(r.plan.dedupe);
        }
        const x = await r.plan.run();
        if (x.ok) done += 1;
        else errs.push(`${r.party.name} ${md(r.card.d)} ${won(r.card.total)} — ${x.error}`);
      }
      setResult(
        errs.length === 0
          ? { tone: "success", text: `${done}장을 ${W.recon}했습니다.` }
          : { tone: "error", text: `${done}장은 ${W.recon}했고 ${errs.length}장은 못 했습니다: ${errs.join(" / ")}` },
      );
      router.refresh();
    });

  if (rows.length === 0) return null;
  return (
    <section className="mt-4 rounded-card border border-amber-300 bg-amber-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          {MARK.confirm.icon} {W.tierCheck} <span className="tabular">{rows.length}</span>장 — 체크해서 한 번에
        </h3>
        <span className="flex items-center gap-3 text-xs">
          <button type="button" onClick={() => setChecked({})} className="text-slate-500 underline underline-offset-4">
            모두 켜기
          </button>
          <button
            type="button"
            onClick={() => setChecked(Object.fromEntries(rows.map((r) => [r.card.id, false])))}
            className="text-slate-500 underline underline-offset-4"
          >
            모두 끄기
          </button>
        </span>
      </div>
      <p className="mt-1 text-xs text-amber-900">앱이 통장 줄을 하나씩 찾아 뒀습니다. 맞으면 그대로, 아니면 체크를 끄고 아래 상대 줄에서 직접 {W.recon}하세요.</p>
      <ul className="mt-2 divide-y divide-amber-200/70">
        {rows.map((r) => (
          <li key={r.card.id} className="py-2">
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={isOn(r.card.id)}
                onChange={(e) => setChecked((c) => ({ ...c, [r.card.id]: e.target.checked }))}
                className="mt-1 size-4 shrink-0 accent-brand-600"
              />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{r.party.name}</span>{" "}
                <span className="text-slate-500">{md(r.card.d)}</span> · <DirAmount direction={r.card.direction} total={r.card.total} />
                <span className="block text-xs text-slate-600">← {r.plan!.text}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <Button onClick={runAll} pending={busy || ctx.pending} disabled={n === 0} size="lg">
          체크한 {n}장 {W.recon}
        </Button>
      </div>
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
    </section>
  );
}

/* ───────────────────────── 카드 목록 (일반 거래처·개인·대행·경비) ───────────────────────── */

function CardList({ party, ctx }: { party: PartyRow; ctx: Ctx }) {
  if (party.cards.length === 0) return <p className="py-2 text-sm text-slate-500">이 달 계산서가 없습니다.</p>;
  return (
    <ul className="mt-1 space-y-2">
      {party.cards.map((c) => (
        <CardView key={c.id} card={c} party={party} ctx={ctx} />
      ))}
    </ul>
  );
}

function CardView({ card: c, party, ctx }: { card: InvoiceCard; party: PartyRow; ctx: Ctx }) {
  const [matching, setMatching] = useState(false);
  const k = `c:${c.id}`;
  const isDone = c.mark === "done";
  const statusLabel = STATUS_LABEL[c.status];
  const openN = party.cards.filter((x) => x.mark !== "done" && x.status === "normal").length;

  const undo = () => ctx.act(k, () => undoTaxMatch(c.id), `되돌렸습니다 — ${W.reconLog}을 풀었습니다.`);
  const expense = async () => {
    if (!party.bizNo) return;
    if (
      !(await ctx.ask({
        title: `${party.name} — 경비로 정리할까요?`,
        body: `이 상대는 앞으로 경비로 자동 정리합니다 — 지금 ${openN}장.\n(잘못 눌렀으면 「${W.activity}」에서 되돌릴 수 있어요)`,
        confirmLabel: "경비로",
      }))
    )
      return;
    const bizNo = party.bizNo;
    ctx.act(k, () => setTaxPartyRule({ bizNo, nameRaw: party.name, kind: "경비" }), "경비로 정리했습니다 — 다음 달부터는 앱이 알아서 합니다.");
  };
  const later = () => ctx.act(k, () => markTaxWaiting(c.id, true), `${W.hold}로 뒀습니다 — ${W.receivable}·${W.payable}은 그대로 남아 있어요.`);
  const ignore = async () => {
    if (
      !(await ctx.ask({
        title: `이 계산서를 ${W.ignore}할까요?`,
        body: `${md(c.d)} ${c.direction} ${won(c.total)}원을 정리 대상에서 뺍니다.\n돈을 받거나 줄 건이면 「${W.hold}」를 쓰세요.`,
        confirmLabel: W.ignore,
        tone: "danger",
      }))
    )
      return;
    ctx.act(k, () => ignoreTaxInvoice(c.id), `${W.ignore}했습니다.`);
  };
  const revive = () => ctx.act(k, () => ignoreTaxInvoice(c.id, true), "다시 정리할 목록으로 돌렸습니다.");
  const unwait = () => ctx.act(k, () => markTaxWaiting(c.id, false), "다시 정리할 목록으로 돌렸습니다.");

  const smallBtn = "rounded-control border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium active:bg-slate-100 disabled:opacity-40";

  return (
    <li className="rounded-card border border-slate-200 bg-white p-3">
      {/* 제목 줄 */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
          <MarkIcon mark={c.mark} />
          <span className="text-sm text-slate-500">{md(c.d)}</span>
          <DirAmount direction={c.direction} total={c.total} />
          {statusLabel && <StatusPill tone="neutral">{statusLabel}</StatusPill>}
        </span>
        {c.itemSummary && <span className="min-w-0 truncate text-xs text-slate-500">{c.itemSummary}</span>}
      </div>

      {/* 두 칸: 누구 → 돈 */}
      <div className="mt-2 grid grid-cols-1 gap-2 text-sm lg:grid-cols-2">
        <div className="rounded-control bg-slate-50 px-3 py-2">
          <span className="block text-xs font-medium text-slate-500">누구</span>
          <span className="flex items-start gap-1.5">
            <MarkIcon mark={c.who.mark} />
            <span className="min-w-0">
              {c.who.text}
              {c.who.chain && (
                <span className="block text-xs text-slate-600">
                  <Link href={c.who.chain.href} className="underline underline-offset-4">
                    {c.who.chain.text}
                  </Link>
                  {c.who.chain.exact && <span className="ml-1 text-brand-700">✅ 원단위 일치</span>}
                </span>
              )}
            </span>
          </span>
        </div>
        <div className="rounded-control bg-slate-50 px-3 py-2">
          <span className="block text-xs font-medium text-slate-500">돈</span>
          <span className="flex items-start gap-1.5">
            <MarkIcon mark={c.money.mark} />
            <span className="min-w-0">{c.money.text}</span>
          </span>
          {c.money.linked.length > 0 && (
            <ul className="mt-1 text-xs text-slate-600">
              {c.money.linked.map((l) => (
                <li key={l.cashTxnId} className="tabular">
                  {W.reconLog}: {l.d} {won(l.amount)}원
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 단추 */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {c.status === "ignored" || c.status === "expense" ? (
          <button type="button" disabled={ctx.pending} onClick={revive} className={smallBtn}>
            다시 보기
          </button>
        ) : c.status === "waiting" ? (
          <>
            <button type="button" disabled={ctx.pending} onClick={() => setMatching((v) => !v)} className={smallBtn}>
              {W.recon}
            </button>
            <button type="button" disabled={ctx.pending} onClick={unwait} className={smallBtn}>
              다시 보기
            </button>
          </>
        ) : isDone ? (
          <button type="button" disabled={ctx.pending} onClick={undo} className="text-sm text-slate-500 underline underline-offset-4 disabled:opacity-40">
            되돌리기
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={ctx.pending}
              onClick={() => setMatching((v) => !v)}
              className={`rounded-control px-3 py-1.5 text-sm font-semibold ${
                matching ? "bg-slate-900 text-white" : "bg-brand-600 text-white active:bg-brand-700"
              } disabled:opacity-40`}
            >
              {W.recon}
            </button>
            {party.bizNo && (
              <button type="button" disabled={ctx.pending} onClick={expense} className={smallBtn}>
                경비
              </button>
            )}
            <button type="button" disabled={ctx.pending} onClick={later} className={smallBtn}>
              {W.hold}
            </button>
            <button type="button" disabled={ctx.pending} onClick={ignore} className={smallBtn}>
              {W.ignore}
            </button>
          </>
        )}
      </div>

      {matching && !isDone && <MatchPanel card={c} ctx={ctx} noteKey={k} onDone={() => setMatching(false)} />}
      <NoteFor ctx={ctx} k={k} />
    </li>
  );
}

/* ───────────────────────── [대사] 패널 ───────────────────────── */

function bankMsg(r: { remaining?: number; shortfall?: number; netted?: boolean; applied?: number; absorbed?: number; settled?: number }) {
  const parts: string[] = [];
  if (r.netted) parts.push(`반대 방향 줄로 ${W.recon}했습니다 — 수수료를 떼고 주고받은 건입니다`);
  if (r.applied && r.applied > 1) parts.push(`${r.applied}줄을 합쳐 ${W.recon}했습니다`);
  if (r.absorbed) parts.push(`통장에 남은 ${won(r.absorbed)}원은 수수료·반올림으로 정리했습니다`);
  if (r.settled) parts.push(`계산서에 모자란 ${won(r.settled)}원은 차액으로 정리했습니다`);
  if (r.shortfall) parts.push(`계산서에 ${won(r.shortfall)}원이 남았습니다 — 다른 줄을 이어서 ${W.recon}하세요`);
  if (r.remaining) parts.push(`통장 줄에 ${won(r.remaining)}원이 남았습니다 (다른 계산서 몫이면 이어서 ${W.recon}하세요)`);
  return parts.length ? `${W.recon}했습니다 — ${parts.join(" · ")}.` : `${W.recon}했습니다 — 금액이 정확히 맞습니다.`;
}

function MatchPanel({ card: c, ctx, noteKey, onDone }: { card: InvoiceCard; ctx: Ctx; noteKey: string; onDone: () => void }) {
  const mo = c.money;
  const [picked, setPicked] = useState<Picked>({});
  const toggle = (it: PickItem) =>
    setPicked((p) => {
      const cur = { ...p };
      const key = Number(it.key);
      if (key in cur) delete cur[key];
      else cur[key] = it.amount ?? 0;
      return cur;
    });
  const target = mo.remain > 0 ? mo.remain : Math.abs(c.total);
  const hasSuggest = mo.picks.length > 0 || !!mo.combo || !!mo.bundle || !!mo.fix || !!mo.fixFirst;
  const [showSearch, setShowSearch] = useState(!hasSuggest);

  const one = (cashTxnId: number) =>
    ctx.act(
      noteKey,
      async () => {
        const r = await confirmTaxToBank(c.id, cashTxnId);
        return r.ok ? { ok: true, msg: bankMsg(r) } : r;
      },
      `${W.recon}했습니다.`,
    );
  const many = (ids: number[]) =>
    ctx.act(
      noteKey,
      async () => {
        const r = await confirmTaxToBanks(c.id, ids);
        return r.ok ? { ok: true, msg: bankMsg(r) } : r;
      },
      `여러 줄을 합쳐 ${W.recon}했습니다.`,
    );

  const sure = mo.picks.filter((p) => p.sure);
  const rest = mo.picks.filter((p) => !p.sure);
  const toItem = (p: BankPick): PickItem => ({ key: p.cashTxnId, label: pickText(p), amount: p.amount, onPick: () => one(p.cashTxnId) });

  return (
    <div className="mt-2 rounded-control border border-brand-500/40 bg-brand-50/40 p-2.5">
      {/* 상계 (수정 계산서) */}
      {mo.fixFirst && (
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0">{mo.fixFirst.label} — {W.offset}가 먼저입니다</span>
          <button
            type="button"
            disabled={ctx.pending}
            onClick={() => {
              const f = mo.fixFirst!;
              ctx.act(noteKey, () => markTaxFixPair(f.minusId, c.id), `원본과 수정 계산서를 ${W.offset}했습니다.`);
            }}
            className="shrink-0 rounded-control bg-brand-600 px-2.5 py-1.5 font-semibold text-white active:bg-brand-700 disabled:opacity-40"
          >
            원본과 {W.offset}
          </button>
        </div>
      )}
      {mo.fix && (
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0">{mo.fix.label}</span>
          <button
            type="button"
            disabled={ctx.pending}
            onClick={() => {
              const f = mo.fix!;
              ctx.act(noteKey, () => markTaxFixPair(c.id, f.originId), `원본과 수정 계산서를 ${W.offset}했습니다.`);
            }}
            className="shrink-0 rounded-control bg-brand-600 px-2.5 py-1.5 font-semibold text-white active:bg-brand-700 disabled:opacity-40"
          >
            원본과 {W.offset}
          </button>
        </div>
      )}
      {/* 통장 한 줄 = 계산서 N장 */}
      {mo.bundle && (
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0">{mo.bundle.label}</span>
          <button
            type="button"
            disabled={ctx.pending}
            onClick={() => {
              const b = mo.bundle!;
              ctx.act(noteKey, () => confirmBankToTaxes(b.cashTxnId, b.invoiceIds), `계산서 ${b.invoiceIds.length}장을 통장 한 줄에 ${W.recon}했습니다.`);
            }}
            className="shrink-0 rounded-control bg-brand-600 px-2.5 py-1.5 font-semibold text-white active:bg-brand-700 disabled:opacity-40"
          >
            이 {c.direction === "매입" ? "출금" : "입금"}으로 {mo.bundle.invoiceIds.length}장
          </button>
        </div>
      )}
      {/* 여러 줄 합이 맞음 */}
      {mo.combo && (
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0">
            {mo.combo.label}
            {mo.combo.diff !== 0 && <span className="text-slate-500"> ({mo.combo.diff > 0 ? "+" : "−"}{won(Math.abs(mo.combo.diff))})</span>}
          </span>
          <button
            type="button"
            disabled={ctx.pending}
            onClick={() => many(mo.combo!.cashTxnIds)}
            className="shrink-0 rounded-control bg-brand-600 px-2.5 py-1.5 font-semibold text-white active:bg-brand-700 disabled:opacity-40"
          >
            {mo.combo.cashTxnIds.length}건 한꺼번에
          </button>
        </div>
      )}
      {/* 후보 한 줄씩 */}
      <PickList hint={sure.length ? "앱이 찾은 줄" : undefined} strong items={sure.map(toItem)} pending={ctx.pending} buttonLabel="이 줄로" picked={picked} onToggle={toggle} />
      <PickList hint={rest.length ? "그 밖의 후보" : undefined} items={rest.map(toItem)} pending={ctx.pending} buttonLabel="이 줄로" picked={picked} onToggle={toggle} />

      {/* 통장 직접 찾기 — 후보가 없으면 바로 펼쳐진다 */}
      {showSearch ? (
        <div className={hasSuggest ? "mt-2 border-t border-dashed border-slate-300 pt-2" : ""}>
          {!hasSuggest && <p className="mb-1 text-xs text-slate-600">앱이 찾은 통장 줄이 없습니다 — 이름이나 금액으로 직접 찾아 {W.recon}하세요.</p>}
          <BankSearch direction={c.direction} pending={ctx.pending} onPick={one} anchor={c.d} picked={picked} onToggle={toggle} />
        </div>
      ) : (
        <button type="button" onClick={() => setShowSearch(true)} className="mt-1.5 text-xs text-slate-500 underline underline-offset-4">
          통장에서 직접 찾기
        </button>
      )}

      <MultiPickBar
        picked={picked}
        target={target}
        pending={ctx.pending}
        onLink={() => {
          many(Object.keys(picked).map(Number));
          setPicked({});
        }}
        onClear={() => setPicked({})}
      />
      {Object.keys(picked).length > 0 && pickedSum(picked) === 0 && (
        <p className="mt-1 text-xs text-slate-400">고른 줄의 남은 금액이 0원입니다.</p>
      )}
      <div className="mt-1.5 text-right">
        <button type="button" onClick={onDone} className="text-xs text-slate-400 underline underline-offset-4">
          닫기
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── 월정산 거래처 펼침 ───────────────────────── */

function MonthlyPanel({ party, s, ym, ctx }: { party: PartyRow; s: MonthlySummary; ym: string; ctx: Ctx }) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(s.baselineDate);
  const [amount, setAmount] = useState(String(s.baselineAmount));
  const [note, setNote] = useState(s.baselineNote ?? "");
  const k = `p:${party.key}`;
  const m = monthOf(ym);

  const save = () => {
    const bizNo = party.bizNo;
    if (!bizNo) return;
    const n = Number(amount.replace(/[^\d-]/g, ""));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    ctx.act(k, () => setTaxBaseline(bizNo, date, Number.isFinite(n) ? n : 0, note.trim() || null), "시작 잔액을 고쳤습니다 — 잔액을 다시 셌습니다.");
    setEditing(false);
  };

  return (
    <div className="text-sm">
      {/* 기준일·시작 잔액 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-white px-3 py-2">
        <span className="min-w-0">
          기준일 <strong>{s.baselineDate}</strong> · 시작 잔액 <strong className="tabular">{won(s.baselineAmount)}</strong>원
          {s.baselineNote && <span className="ml-1 text-xs text-slate-500">({s.baselineNote})</span>}
        </span>
        {party.bizNo && (
          <button type="button" onClick={() => setEditing((v) => !v)} className="shrink-0 text-xs text-slate-500 underline underline-offset-4">
            {editing ? "닫기" : "고치기"}
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-2 grid grid-cols-1 gap-2 rounded-control border border-slate-200 bg-white p-3 sm:grid-cols-3">
          <Field label="기준일" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Field label="그 날 잔액(원)" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} hint="세무사 원장 잔액을 그대로" />
          <Field label="메모" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 세무사 원장 8/24" />
          <div className="sm:col-span-3">
            <Button onClick={save} pending={ctx.pending} disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)}>
              저장
            </Button>
          </div>
        </div>
      )}

      {/* 셈 */}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat label="계산서(기준일부터)" value={s.invoiced} />
        <Stat label="준 돈(기준일부터)" value={s.paid} />
        <Stat label="잔액" value={s.remain} strong tone={s.remain > 0 ? "warn" : "ok"} />
      </div>
      {s.paidPast > 0 && (
        <p className="mt-1 text-xs text-slate-600">
          그 전 것 갚음 <strong className="tabular">{won(s.paidPast)}</strong>원 — 기준일 전 계산서 몫을 이 기간에 준 것입니다.
        </p>
      )}
      <p className="mt-1.5 text-xs text-slate-600">
        이 달({m}월): 계산서 <span className="tabular">{won(s.monthInvoiced)}</span> · 준 돈 <span className="tabular">{won(s.monthPaid)}</span>
      </p>
      {s.appReceived !== null && (
        <p className="mt-0.5 text-xs text-slate-600">
          앱 입고 <span className="tabular">{won(s.appReceived)}</span>
          {s.appGap !== null && s.appGap > 0 ? (
            <>
              {" "}
              → <span className="text-amber-800">앱에 안 넣은 매입 <strong className="tabular">{won(s.appGap)}</strong></span>{" "}
              <Link href="/receiving" className="underline underline-offset-4">
                입고 화면 ▸
              </Link>
            </>
          ) : s.appGap !== null && s.appGap < 0 ? (
            <span className="text-slate-500"> — 계산서보다 <span className="tabular">{won(-s.appGap)}</span> 더 넣었습니다(월말 일괄 발행이면 정상)</span>
          ) : (
            <span className="text-brand-700"> — 계산서와 맞음</span>
          )}
        </p>
      )}
      {s.remain <= 0 && <p className="mt-1 text-xs text-brand-700">잔액이 없어 이 달 계산서는 앱이 {W.done} 처리합니다.</p>}

      {/* 계산서 / 지급 두 열 */}
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold text-slate-500">계산서 {s.invoices.length}장</h4>
          <div className="overflow-x-auto">
            <table className="mt-1 w-full text-xs">
              <tbody>
                {s.invoices.length === 0 && (
                  <tr>
                    <td className="py-1 text-slate-400">없음</td>
                  </tr>
                )}
                {s.invoices.map((i) => (
                  <tr key={i.id} className="border-t border-slate-100">
                    <td className="py-1 text-slate-500">{md(i.d)}</td>
                    <td className="tabular py-1 text-right font-medium">{won(i.total)}</td>
                    <td className="py-1 pl-2 text-slate-500">{STATUS_LABEL[i.status] ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h4 className="text-xs font-semibold text-slate-500">준 돈 {s.payments.length}건</h4>
          <div className="overflow-x-auto">
            <table className="mt-1 w-full text-xs">
              <tbody>
                {s.payments.length === 0 && (
                  <tr>
                    <td className="py-1 text-slate-400">없음</td>
                  </tr>
                )}
                {s.payments.map((p) => (
                  <tr key={p.cashTxnId} className="border-t border-slate-100">
                    <td className="py-1 text-slate-500">{md(p.d)}</td>
                    <td className="tabular py-1 text-right font-medium">{won(p.amount)}</td>
                    <td className="max-w-[12rem] truncate py-1 pl-2 text-slate-500">{p.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: "warn" | "ok" }) {
  return (
    <div className="rounded-control bg-white px-3 py-2">
      <span className="block text-xs text-slate-500">{label}</span>
      <span className={`tabular block ${strong ? "text-base font-bold" : "font-medium"} ${tone === "warn" ? "text-amber-800" : tone === "ok" ? "text-brand-700" : ""}`}>
        {won(value)}원{tone === "ok" && strong ? " · 맞음" : ""}
      </span>
    </div>
  );
}
