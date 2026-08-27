"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDotQty, setLotReceivedDate } from "@/lib/stock";
import { Pencil } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm";

/**
 * ⭐ 화면에서 바로 수량 고치기 (사장님 지시 2026-08-04)
 *
 *   "재고 변경이 엑셀로만 되는 점이 불편함."
 *
 * 🔴 2026-08-03 의 「엑셀로만 고친다」 지시가 **뒤집혔다.** 알고 뒤집는다 —
 *    한두 줄 고치자고 엑셀을 내려받아 다시 올리는 것이 실사용에서 더 불편했다.
 *    엑셀은 **여러 상품을 한꺼번에** 맞출 때(전수 실사)의 길로 그대로 남는다.
 *
 * 서버 쪽 `setDotQty` 는 처음부터 있었다(실사 반영용). 화면만 없었을 뿐이다.
 * 「이 DOT 는 실제로 몇 본이더라」를 그대로 치면 조정 이력까지 남는다.
 */
export function QtyEditor({
  productId,
  dot,
  qty,
  unit,
}: {
  productId: number;
  dot: string | null;
  qty: number;
  unit: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(qty));
  const [error, setError] = useState<string | null>(null);
  const [ask, confirmDialog] = useConfirm(); // 배치4 — confirm() 대체

  async function save() {
    /**
     * 🔴 빈 칸은 0 이 아니다 (코드 리뷰 2026-08-08).
     *    Number("") === 0 이라, 칸을 지운 채 Enter 를 치면 그 DOT 전량이
     *    확인 없이 폐기 처리됐다. 빈 칸은 막고, 진짜 0 은 한 번 물어본다.
     */
    if (value.trim() === "") {
      setError("수량을 입력해 주세요");
      return;
    }
    const n = Number(value);
    if (n === 0 && qty > 0) {
      if (
        !(await ask({
          title: `${qty}${unit}을 전부 폐기할까요?`,
          body: "0으로 저장하면 이 DOT 가 재고에서 사라집니다.",
          tone: "danger",
          confirmLabel: "폐기 처리",
        }))
      )
        return;
    }
    start(async () => {
      setError(null);
      const r = await setDotQty({ productId, dot, qty: n, reason: "실사조정" });
      if (!r.ok) return setError(r.error);
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(String(qty));
          setEditing(true);
        }}
        className="tabular rounded-lg px-2 py-1 text-2xl font-bold active:bg-slate-100"
        aria-label="수량 고치기"
      >
        {qty}
        <span className="ml-0.5 text-sm font-medium text-slate-500">{unit}</span>
        <Pencil className="ml-1.5 inline size-4 align-middle text-slate-400" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="tabular w-20 rounded-lg border-2 border-slate-900 px-2 py-1.5 text-right text-xl font-bold outline-none"
      />
      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        저장
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="rounded-lg px-2 py-2 text-sm text-slate-500"
      >
        취소
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
      {confirmDialog}
    </div>
  );
}

/**
 * ⭐ 입고일 — 보여주고, 눌러서 고친다 (사장님 지시 2026-08-27)
 *
 *   "타이어 매입시 dot를 붙이면 가장 좋지만 못할때도 많으니
 *    매입한 날짜도 dot와 함께 붙여주었으면 좋겠음."
 *
 * 🔴 고칠 수 있어야 하는 이유가 있다. 지금 저장된 입고일은 **실제로 받은 날이 아니라
 *    「앱에 넣은 날」** 이다 — 2026-08 재고 실사로 1,233본을 한꺼번에 넣은 탓에
 *    재고 전량이 "최근 3개월 입고" 로 보인다. 사장님이 아는 날짜로 고칠 길이 없으면
 *    이 값은 영영 거짓이고, 그 위에 세운 선입선출도 같이 거짓이 된다.
 *
 * DOT 칸과 달리 **연필을 눌러야** 열린다 — 평소엔 조용히 한 줄로만 있으면 된다.
 */
export function ReceivedEditor({
  productId,
  dot,
  label,
  date,
  spread,
}: {
  productId: number;
  dot: string | null;
  /** `8/12 입고` · 여러 날이면 `8/12~8/20 입고` */
  label: string;
  /** `YYYY-MM-DD` — 입력칸의 처음 값 */
  date: string | null;
  /** 여러 날에 걸쳐 들어왔나 — 고치면 한 날로 모인다는 것을 알려야 한다 */
  spread: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(date ?? "");
  const [error, setError] = useState<string | null>(null);

  function save() {
    start(async () => {
      setError(null);
      const r = await setLotReceivedDate({ productId, dot, date: value });
      if (!r.ok) return setError(r.error);
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(date ?? "");
          setEditing(true);
        }}
        className="mt-1 flex items-center gap-1.5 text-sm text-slate-500 active:text-slate-800"
      >
        <span className="tabular">{label || "입고일 모름"}</span>
        <Pencil className="size-3.5 shrink-0" aria-hidden />
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg bg-slate-50 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          max={new Date().toISOString().slice(0, 10)}
          className="tabular min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
        />
        <button
          type="button"
          onClick={save}
          disabled={pending || !value}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-lg px-2 py-2 text-sm text-slate-500"
        >
          취소
        </button>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
        타이어를 <strong>받은 날</strong>입니다. 만든 때(DOT)와는 다릅니다.
        {spread && " 여러 날에 걸쳐 들어온 묶음이라, 저장하면 이 날 하나로 모입니다."}
      </p>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** DOT 를 새로 추가하며 수량을 넣는다 — 실물엔 있는데 화면에 줄이 없을 때 */
export function AddDotRow({ productId }: { productId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [dot, setDot] = useState("");
  const [qty, setQty] = useState("");
  const [error, setError] = useState<string | null>(null);

  function save() {
    start(async () => {
      setError(null);
      const r = await setDotQty({
        productId,
        dot: dot.trim() || null,
        qty: Number(qty),
        reason: "실사조정",
      });
      if (!r.ok) return setError(r.error);
      setOpen(false);
      setDot("");
      setQty("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 w-full rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-500 active:bg-slate-50"
      >
        + 다른 DOT 추가
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-slate-300 bg-slate-50 p-3">
      <div className="flex gap-2">
        <input
          value={dot}
          onChange={(e) => setDot(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="DOT (예: 1826)"
          inputMode="numeric"
          className="tabular min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5"
        />
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
          placeholder="수량"
          inputMode="numeric"
          className="tabular w-20 rounded-lg border border-slate-300 px-3 py-2.5 text-right"
        />
      </div>
      <p className="mt-1 text-xs text-slate-500">DOT 를 모르면 비워 두세요 — 「DOT 없음」 줄로 들어갑니다</p>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600"
        >
          취소
        </button>
        <button
          type="button"
          disabled={pending || !qty}
          onClick={save}
          className="flex-1 rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          추가
        </button>
      </div>
    </div>
  );
}
