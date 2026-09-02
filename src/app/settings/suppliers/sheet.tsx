"use client";

/**
 * ⭐ 거래처 한 장 (사장님 요청 2026-09-02) — 돈·별명·차량·규칙·최근 매입.
 *    전부 기존 정본 액션 재사용 — 판정·별명·규칙을 여기서 다시 쓰지 않는다.
 *    사장님 전용 (page 가 owner 일 때만 extras 를 내려준다).
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import { recentPurchases, updateSupplier, type SupplierExtras, type SupplierRow } from "@/lib/supplier";
import { addSupplierAlias, removeSupplierAlias } from "@/lib/purchase-pay";
import { removeTaxPartyRule, setTaxPartyRule } from "@/lib/recon";
import { moveVehicleToSupplier } from "@/lib/customer-edit";
import { searchVehicles } from "@/lib/search-actions";
import type { VehicleHit } from "@/lib/search";

const won = (n: number) => n.toLocaleString("ko-KR");

export function SupplierSheet({ s, extras }: { s: SupplierRow; extras: SupplierExtras }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const money = extras.money[s.name];
  const aliases = extras.aliases[s.name] ?? [];
  const garage = extras.garage[s.name] ?? [];
  const suggest = !s.bizNo ? extras.bizSuggest[s.name] : undefined;
  const kind = extras.rule[s.name];

  const [aliasIn, setAliasIn] = useState("");
  const [vq, setVq] = useState("");
  const [vhits, setVhits] = useState<VehicleHit[]>([]);
  const vt = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!vq.trim()) return setVhits([]);
    if (vt.current) clearTimeout(vt.current);
    vt.current = setTimeout(() => void searchVehicles(vq.trim()).then((r) => setVhits(r.slice(0, 5))), 250);
    return () => {
      if (vt.current) clearTimeout(vt.current);
    };
  }, [vq]);
  const [confirmMove, setConfirmMove] = useState<VehicleHit | null>(null);

  /* 최근 매입 — 펼칠 때 한 번 (지연 로딩, 페이지는 가볍게) */
  const [recent, setRecent] = useState<
    { id: number; d: string; total: number | null; status: string; items: number }[] | null
  >(null);
  useEffect(() => {
    void recentPurchases(s.name)
      .then((r) => r.ok && setRecent(r.rows))
      .catch(() => {});
  }, [s.name]);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string } | { ok: boolean; error?: string }>, okMsg?: string) =>
    start(async () => {
      setErr(null);
      setMsg(null);
      const r = await fn();
      if (!r.ok) return setErr(("error" in r && r.error) || "실패했습니다");
      if (okMsg) setMsg(okMsg);
      router.refresh();
    });

  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}

      {/* ── 돈 요약 + 바로가기 ── */}
      <div className="rounded-xl bg-slate-50 p-2.5">
        <div className="tabular flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span>
            받을 돈 <strong className="text-amber-800">{won(money?.receivable ?? 0)}원</strong>
          </span>
          <span>
            줄 돈 <strong className="text-rose-800">{won(money?.payable ?? 0)}원</strong>
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <Link href={`/finance/party/${encodeURIComponent("S:" + s.name)}`} className="text-slate-600 underline underline-offset-4">
            원장(모든 돈 흐름) →
          </Link>
          <Link href={`/receivables/settle/${encodeURIComponent(s.name)}`} className="text-slate-600 underline underline-offset-4">
            월 정산 →
          </Link>
          <Link href="/finance/payables" className="text-slate-600 underline underline-offset-4">
            미지급 →
          </Link>
        </div>
      </div>

      {/* ── 사업자번호 — 올린 계산서에서 자동 수집 (저장은 한 번 눌러 확인) ── */}
      {suggest && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-2.5 text-sm">
          <p className="text-emerald-900">
            ✨ 올리신 계산서에서 찾음: <strong className="tabular">{suggest.bizNo}</strong>
            <span className="text-emerald-700">
              {" "}
              ({suggest.nameRaw} · 계산서 {suggest.n}장)
            </span>
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () => updateSupplier({ id: s.id, name: s.name, phone: s.phone ?? "", memo: s.memo ?? "", bizNo: suggest.bizNo }),
                "사업자번호를 채웠습니다 — 계산서 자동확정·원장이 이제 이 번호로 이어집니다",
              )
            }
            className="mt-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            이 번호로 채우기
          </button>
        </div>
      )}

      {/* ── 월정산 상대 규칙 ── */}
      <div className="rounded-xl bg-slate-50 p-2.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-600">
            계산서 자동 분류: <strong>{kind ?? "없음"}</strong>
            {kind === "월정산" && <span className="text-slate-400"> — 달 단위 잔액으로 확인</span>}
          </span>
          {s.bizNo ? (
            kind === "월정산" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => removeTaxPartyRule(s.bizNo!), "월정산 분류를 껐습니다")}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600"
              >
                월정산 끄기
              </button>
            ) : (
              <button
                type="button"
                disabled={pending || !!kind}
                title={kind ? `이미 「${kind}」 규칙이 있습니다 — 계산서 화면에서 바꿔 주세요` : undefined}
                onClick={() =>
                  run(
                    () => setTaxPartyRule({ bizNo: s.bizNo!, nameRaw: s.name, kind: "월정산" }),
                    "이 거래처 계산서는 달 단위 정산으로 분류합니다",
                  )
                }
                className="rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                월정산 켜기
              </button>
            )
          ) : (
            <span className="text-xs text-slate-400">사업자번호부터 채워 주세요</span>
          )}
        </div>
      </div>

      {/* ── 통장 이름 짝(별명) ── */}
      <div className="rounded-xl bg-slate-50 p-2.5">
        <p className="text-sm font-medium text-slate-700">통장·계산서 이름 짝</p>
        <p className="mt-0.5 text-xs text-slate-400">
          「스칼릿주식회사」처럼 다르게 찍히는 이름을 이어 두면 입금·출금·계산서가 자동으로 이 거래처로 모입니다.
        </p>
        <ul className="mt-1.5 space-y-1">
          {aliases.map((a) => (
            <li key={a.key} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{a.raw}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => removeSupplierAlias(s.name, a.key), "이름 짝을 지웠습니다")}
                className="shrink-0 px-1 text-slate-400 active:text-red-600"
              >
                ✕
              </button>
            </li>
          ))}
          {aliases.length === 0 && <li className="text-xs text-slate-400">아직 없습니다</li>}
        </ul>
        <div className="mt-1.5 flex gap-2">
          <input
            value={aliasIn}
            onChange={(e) => setAliasIn(e.target.value)}
            list="supplier-payer-names"
            placeholder="통장에 찍히는 이름 — 예: 스칼릿주식회사"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={pending || aliasIn.trim().length < 2}
            onClick={() =>
              run(async () => {
                const r = await addSupplierAlias(s.name, aliasIn.trim());
                if (r.ok) setAliasIn("");
                return r;
              }, "이름 짝을 이었습니다")
            }
            className="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            잇기
          </button>
        </div>
      </div>

      {/* ── 차량 (거래처 차고) ── */}
      <div className="rounded-xl bg-slate-50 p-2.5">
        <p className="text-sm font-medium text-slate-700">
          거래처 차량 {garage.length > 0 && `(${garage.length}대)`}
        </p>
        <ul className="mt-1 space-y-0.5">
          {garage.map((v) => (
            <li key={v.vehicleId} className="tabular text-sm">
              <Link href={`/vehicle/${v.vehicleId}`} className="underline underline-offset-4">
                {v.plateNo}
              </Link>
              {v.model && <span className="ml-1.5 text-slate-500">{v.model}</span>}
              {v.lastVisit && <span className="ml-1.5 text-xs text-slate-400">최근 {v.lastVisit.slice(5)}</span>}
            </li>
          ))}
          {garage.length === 0 && (
            <li className="text-xs text-slate-400">아직 없습니다 — 판매 등록의 거래처 카드에서도 담을 수 있습니다</li>
          )}
        </ul>
        <input
          value={vq}
          onChange={(e) => setVq(e.target.value)}
          placeholder="개인 고객 차량 가져오기 — 차량번호 검색"
          className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        {vhits.length > 0 && (
          <ul className="mt-1 space-y-1">
            {vhits
              .filter((h) => !garage.some((g) => g.vehicleId === h.vehicleId))
              .map((h) => (
                <li key={h.vehicleId}>
                  <button
                    type="button"
                    onClick={() => setConfirmMove(h)}
                    className="flex w-full items-baseline gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-sm active:bg-slate-100"
                  >
                    <span className="font-medium">{h.plateNo}</span>
                    <span className="min-w-0 truncate text-xs text-slate-500">
                      {[h.model, h.customerName].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        )}
        {confirmMove && (
          <div className="mt-2 rounded-lg border-2 border-violet-400 bg-violet-50 p-2.5 text-sm">
            <p className="text-violet-900">
              <strong>{confirmMove.plateNo}</strong>
              {confirmMove.customerName ? ` (${confirmMove.customerName})` : ""} 을(를) 이 거래처 차량으로 가져올까요?
            </p>
            <p className="mt-0.5 text-xs text-violet-700">
              정비 이력은 차량에 그대로 따라가고, 지난 외상의 주인은 안 바뀝니다.
            </p>
            <div className="mt-1.5 flex gap-2">
              <button type="button" onClick={() => setConfirmMove(null)} className="rounded-lg px-3 py-1.5 text-xs text-slate-500">
                그만두기
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const r = await moveVehicleToSupplier(confirmMove.vehicleId, s.name);
                    if (r.ok) {
                      setConfirmMove(null);
                      setVq("");
                    }
                    return r;
                  }, "가져왔습니다")
                }
                className="flex-1 rounded-lg bg-violet-700 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                가져오기
              </button>
            </div>
          </div>
        )}
        <p className="mt-1 text-xs text-slate-400">
          거래처 차량이 개인 손님으로 오면 「새 손님 등록」 때 자동으로 그 손님에게 넘어갑니다.
        </p>
      </div>

      {/* ── 최근 매입 ── */}
      <div className="rounded-xl bg-slate-50 p-2.5">
        <p className="text-sm font-medium text-slate-700">최근 매입</p>
        {recent === null ? (
          <p className="mt-1 text-xs text-slate-400">불러오는 중…</p>
        ) : recent.length === 0 ? (
          <p className="mt-1 text-xs text-slate-400">매입 내역이 없습니다</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {recent.map((r) => (
              <li key={r.id} className="tabular flex items-baseline justify-between gap-2 text-sm">
                <span className="text-slate-600">
                  {r.d} · {r.items}줄 · {r.status}
                </span>
                <span className="shrink-0 font-medium">{r.total === null ? "금액 없음" : `${won(r.total)}원`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
