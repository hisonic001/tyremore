"use client";

/**
 * ⭐ 정비 내역 — 품목 줄 수정·삭제·추가 (사장님 요청 2026-08-05 "수정도 더 자유롭게")
 *
 * 전에는 「틀렸으면 취소하고 다시 등록」뿐이었다. 이제 줄 하나를 바로 고친다.
 * 재고는 서버가 따라 맞춘다 — 수량이 늘면 더 빠지고, 줄면 되살아난다.
 * 🔴 MARS 에 보낸 판매(미전송·전송완료)는 서버가 품목 수정을 막는다
 *    (사장님 결정 2026-08-31 — "전송 전에만"). 막힌 이유와 빠져나갈 길(수동처리)은
 *    서버가 돌려주는 문구 그대로 위 알림띠에 보인다.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RateBox } from "../rate-box";
import { addSaleLine, removeSaleLine, updateSaleLine } from "@/lib/sale-edit";
import { useConfirm } from "@/components/ui/confirm";
import { signedStr, showSigned } from "@/lib/signed-input";
import { findServices } from "@/lib/sale";
import { searchProducts } from "@/lib/search-actions";
import type { ProductHit } from "@/lib/search";
import type { SaleLine } from "@/lib/sale-history";

const won = (n: number) => n.toLocaleString("ko-KR");

export function EditableLine({ line: l, onMessage }: { line: SaleLine; onMessage: (m: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, confirmDialog] = useConfirm(); // 배치3 — confirm() 대체
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(l.qty);
  const [price, setPrice] = useState(String(l.finalPrice));
  /** ⭐ 품명도 키보드로 고친다 (사장님 요청 2026-08-06) */
  const [desc, setDesc] = useState(l.description);
  /** ⭐ 줄별 메모 (사장님 지시 2026-08-07) — MARS 이 줄의 「설명 2」에 들어간다 */
  const [memo, setMemo] = useState(l.memo ?? "");

  const save = () =>
    start(async () => {
      const r = await updateSaleLine({
        itemId: l.itemId,
        qty,
        unitPrice: Number(price) || 0,
        description: desc,
        memo: memo.trim() || null,
      });
      if (!r.ok) return onMessage(`⚠️ ${r.error}`);
      onMessage(
        `고쳤습니다.${r.shortage > 0 ? ` ⚠️ 재고가 ${r.shortage}본 모자랍니다.` : ""}${r.warning ? ` ⚠️ ${r.warning}` : ""}`,
      );
      setEditing(false);
      router.refresh();
    });

  const remove = async () => {
    if (!(await ask({ title: "이 줄을 지울까요?", body: `「${l.description}」 — 재고는 되살아납니다.`, tone: "danger", confirmLabel: "지우기" })))
      return;
    start(async () => {
      const r = await removeSaleLine(l.itemId);
      if (!r.ok) return onMessage(`⚠️ ${r.error}`);
      onMessage(`지웠습니다 — 재고 ${r.restored}개 복원.${r.warning ? ` ⚠️ ${r.warning}` : ""}`);
      router.refresh();
    });
  };

  if (!editing) {
    return (
      <li className="text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate">
            {l.lineType === "service" && <span className="mr-1 text-xs text-slate-400">공임</span>}
            {l.description}
            {/* ⭐ 타이어 규격 (사장님 요청 2026-08-07) */}
            {l.spec && <span className="tabular ml-1 text-xs text-slate-500">{l.spec}</span>}
          </span>
          <span className="flex shrink-0 items-baseline gap-2">
            <span className="tabular text-slate-600">
              {l.qty > 1 && `${l.qty} × `}
              {won(l.finalPrice)}원
            </span>
            {l.qty > 1 && <span className="tabular text-xs text-slate-400">= {won(l.qty * l.finalPrice)}원</span>}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 active:bg-slate-100"
            >
              고치기
            </button>
          </span>
        </div>
        {/* ⭐ 줄별 메모 (사장님 지시 2026-08-07) — 펼치면 품목 아래에 보인다 */}
        {l.memo && <p className="mt-0.5 pl-1 text-xs text-slate-500">└ {l.memo}</p>}
        {confirmDialog}
      </li>
    );
  }

  return (
    <li className="rounded-lg bg-slate-50 p-2">
      {confirmDialog}
      {/* 품명 — 자유롭게 타이핑해 바꿀 수 있다 */}
      <input
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="품목 이름"
        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="h-9 w-9 rounded-lg border border-slate-300 bg-white text-lg font-bold"
          >
            −
          </button>
          <input
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))}
            inputMode="numeric"
            className="tabular h-9 w-12 rounded-lg border border-slate-300 bg-white text-center font-bold"
          />
          <button
            type="button"
            onClick={() => setQty((q) => q + 1)}
            className="h-9 w-9 rounded-lg border border-slate-300 bg-white text-lg font-bold"
          >
            +
          </button>
        </div>
        <label className="ml-auto flex items-center gap-1">
          <input
            value={showSigned(price)}
            onChange={(e) => setPrice(signedStr(e.target.value))} // '-' 허용 — 환불 줄 (2026-08-21)
            inputMode="numeric"
            className="tabular h-9 w-28 rounded-lg border border-slate-300 px-2 text-right text-sm"
          />
          <span className="text-xs text-slate-500">원</span>
        </label>
      </div>
      {/* ⭐ 검색 카드와 같은 할인 계산 (사장님 요청 2026-08-08) — %를 치면 단가가 따라온다 */}
      {l.listPrice ? (
        <div className="mt-1.5 flex justify-end">
          <RateBox listPrice={l.listPrice} price={Number(price) || 0} onPrice={(n) => setPrice(String(n))} />
        </div>
      ) : null}
      {/* ⭐ 줄별 메모 (사장님 지시 2026-08-07) — MARS 이 줄의 「설명 2」로 들어간다 */}
      <input
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder="이 줄 메모 (선택) — MARS 설명 2"
        className="mt-1.5 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={remove}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600"
        >
          줄 지우기
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setEditing(false)}
          className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600"
        >
          취소
        </button>
        <button
          type="button"
          disabled={pending || !desc.trim()}
          onClick={save}
          className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          저장
        </button>
      </div>
    </li>
  );
}

/** 품목 추가 — 타이어(상품 검색) 또는 공임(서비스 검색) */
export function AddLine({
  quoteId,
  onMessage,
  owner = false,
}: {
  quoteId: number;
  onMessage: (m: string) => void;
  /** 사장님이면 공임 검색 아래에 「새 공임 만들기」 길을 보여준다 (관리 화면이 사장님 전용) */
  owner?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<null | "tire" | "service" | "custom">(null);
  const [q, setQ] = useState("");
  const [tires, setTires] = useState<ProductHit[]>([]);
  const [svcs, setSvcs] = useState<Awaited<ReturnType<typeof findServices>>>([]);
  /** ⭐ 직접 입력 (사장님 요청 2026-08-06) — 목록에 없는 내용도 자유롭게 적는다 */
  const [cDesc, setCDesc] = useState("");
  const [cQty, setCQty] = useState(1);
  const [cPrice, setCPrice] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || open === "custom") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (open === "tire") {
        if (!q.trim()) return setTires([]);
        // 타이어 줄 추가·교체이므로 타이어만 (2026-08-14 검색 분리)
        void searchProducts(q, { itemType: "tire" }).then((r) => setTires(r.slice(0, 6)));
      } else {
        void findServices(q).then((r) => setSvcs(r.slice(0, 6)));
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, open]);

  const add = (input: Parameters<typeof addSaleLine>[0]) =>
    start(async () => {
      const r = await addSaleLine(input);
      if (!r.ok) return onMessage(`⚠️ ${r.error}`);
      onMessage(
        `담았습니다.${r.shortage > 0 ? ` ⚠️ 재고가 ${r.shortage}본 모자랍니다.` : ""}${r.warning ? ` ⚠️ ${r.warning}` : ""}`,
      );
      setOpen(null);
      setQ("");
      router.refresh();
    });

  if (!open) {
    return (
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => setOpen("tire")}
          className="flex-1 rounded-lg border border-dashed border-slate-400 py-2 text-sm font-medium text-slate-600 active:bg-slate-50"
        >
          + 타이어·부품 추가
        </button>
        <button
          type="button"
          onClick={() => setOpen("service")}
          className="flex-1 rounded-lg border border-dashed border-slate-400 py-2 text-sm font-medium text-slate-600 active:bg-slate-50"
        >
          + 공임·정비 추가
        </button>
        <button
          type="button"
          onClick={() => setOpen("custom")}
          className="flex-1 rounded-lg border border-dashed border-slate-400 py-2 text-sm font-medium text-slate-600 active:bg-slate-50"
        >
          + 직접 입력
        </button>
      </div>
    );
  }

  /* ⭐ 직접 입력 — 검색 없이 품명·수량·단가를 타이핑한다. 재고와는 무관하다 */
  if (open === "custom") {
    return (
      <div className="mt-2 rounded-xl bg-slate-50 p-2">
        <input
          value={cDesc}
          onChange={(e) => setCDesc(e.target.value)}
          placeholder="내용  예: 얼라이먼트 조정, 폐타이어 수거…"
          autoFocus
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <label className="flex items-center gap-1">
            <input
              value={cQty}
              onChange={(e) => setCQty(Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))}
              inputMode="numeric"
              className="tabular h-9 w-12 rounded-lg border border-slate-300 bg-white text-center text-sm font-bold"
            />
            <span className="text-xs text-slate-500">개</span>
          </label>
          <label className="ml-auto flex items-center gap-1">
            <input
              value={cPrice === "" ? "" : Number(cPrice).toLocaleString()}
              onChange={(e) => setCPrice(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="단가"
              className="tabular h-9 w-28 rounded-lg border border-slate-300 px-2 text-right text-sm"
            />
            <span className="text-xs text-slate-500">원</span>
          </label>
        </div>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => setOpen(null)} className="text-xs text-slate-500 underline">
            닫기
          </button>
          <button
            type="button"
            disabled={pending || !cDesc.trim()}
            onClick={() => {
              add({ quoteId, kind: "custom", description: cDesc.trim(), qty: cQty, unitPrice: Number(cPrice) || 0 });
              setCDesc("");
              setCQty(1);
              setCPrice("");
            }}
            className="ml-auto rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            추가
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl bg-slate-50 p-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={open === "tire" ? "규격·모델명  예: 2454518" : "공임 이름  예: 펑크"}
        autoFocus
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <ul className="mt-1.5 space-y-1">
        {open === "tire"
          ? tires.map((h) => (
              <li key={h.productId}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    add({
                      quoteId,
                      kind: "tire",
                      productId: h.productId,
                      description: h.model,
                      qty: 1,
                      unitPrice: h.salePrice ?? h.listPrice ?? 0,
                    })
                  }
                  className="w-full rounded-lg bg-white px-3 py-1.5 text-left text-sm active:bg-slate-100"
                >
                  <span className="font-medium">{h.model}</span>
                  <span className="tabular ml-2 text-xs text-slate-500">
                    {h.spec} · {won(h.salePrice ?? h.listPrice ?? 0)}원
                  </span>
                </button>
              </li>
            ))
          : svcs.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    add({
                      quoteId,
                      kind: "service",
                      serviceItemId: s.id,
                      description: s.name,
                      qty: 1,
                      unitPrice: s.price ?? 0,
                    })
                  }
                  className="w-full rounded-lg bg-white px-3 py-1.5 text-left text-sm active:bg-slate-100"
                >
                  <span className="font-medium">{s.name}</span>
                  {s.price !== null && <span className="tabular ml-2 text-xs text-slate-500">{won(s.price)}원</span>}
                </button>
              </li>
            ))}
      </ul>
      {/* ⭐ 목록에 없으면 즉석에서 만든다 (사장님 요청 2026-08-31) — 새 탭, 만들면 검색에 바로 뜬다 */}
      {open === "service" && owner && (
        <a
          href="/settings/services?new=1"
          target="_blank"
          className="mt-1.5 block rounded-lg border border-dashed border-slate-400 py-2 text-center text-sm font-medium text-slate-600 active:bg-slate-100"
        >
          + 새 공임·정비 만들기 (목록에 없을 때)
        </a>
      )}
      <button type="button" onClick={() => setOpen(null)} className="mt-1.5 text-xs text-slate-500 underline">
        닫기
      </button>
    </div>
  );
}
