"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import { applyFinUpload, previewFinUpload, type FinPreview } from "@/lib/fin-upload";

/** 파일 종류별 다음 화면 (2026 감사 R5) */
function nextStepOf(source: string, ym: string): { href: string; label: string } {
  if (source.includes("통장")) return { href: `/finance/deposits?ym=${ym}`, label: "입금 정리로 →" };
  if (source.includes("법인카드")) return { href: `/finance/expenses?ym=${ym}`, label: "지출 분류로 →" };
  if (source.includes("토스포스")) return { href: `/finance/card?ym=${ym}`, label: "카드 일마감으로 →" };
  if (source.includes("카드매출")) return { href: `/finance/card?ym=${ym}`, label: "카드 매출 맞추기로 →" };
  if (source.includes("홈택스")) return { href: `/finance/tax?view=money&ym=${ym}`, label: "세금계산서 돈 확인으로 →" };
  return { href: `/finance?ym=${ym}`, label: "현황으로 →" };
}

const won = (n: number) => n.toLocaleString("ko-KR");

/**
 * ⭐ 돈 관리 — 엑셀 올리기 (ERP 1~2단계, 2026-08-24)
 *
 *   고르기 → **미리보기 강제** → (통장·카드면 계정 이름 적고) 확정.
 *   파일 종류(통장·법인카드·홈택스 세금계산서)는 서버가 알아본다.
 *   같은 파일을 다시 올려도 안전하다 — 이미 있는 줄은 「이미 있음」으로 세기만 한다.
 */
export function FinUpload({ ym }: { ym: string }) {
  const router = useRouter();
  const [next, setNext] = useState<{ href: string; label: string } | null>(null);
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FinPreview | null>(null);
  const [label, setLabel] = useState("");
  /** 🔴 감사 M15: 계정 이름 오타(신한주거래/신한 주거래)가 같은 파일을 통째로 중복시킨다 —
      기존 계정은 고르게 하고, 새 계정만 직접 입력 */
  const [newLabel, setNewLabel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function onPick(f: File | null) {
    setError(null);
    setDoneMsg(null);
    setPreview(null);
    setFile(f);
    if (!f) return;
    const fd = new FormData();
    fd.set("file", f);
    start(async () => {
      /* 🔴 서버 액션이 터지면(배포 직후 옛 화면 등) 조용히 끝났다 — 반드시 말로 남긴다 (2026-08-31) */
      try {
        const r = await previewFinUpload(fd);
        if (!r.ok) return setError(r.error);
        setPreview(r.preview);
        if (!label && r.preview.labels.length === 1) setLabel(r.preview.labels[0]);
      } catch {
        setError("서버와 연결이 어긋났습니다 — 화면을 새로고침한 뒤 다시 올려 주세요");
      }
    });
  }

  function onApply() {
    if (!file || !preview) return;
    const fd = new FormData();
    fd.set("file", file);
    if (preview.kind === "cash") fd.set("label", label);
    start(async () => {
      try {
      const r = await applyFinUpload(fd);
      if (!r.ok) return setError(r.error);
      setDoneMsg(`${r.source} 반영했습니다 — 새로 ${r.newCount}줄 · 이미 있음 ${r.dupCount}줄`);
      setNext(nextStepOf(r.source, ym));
      setPreview(null);
      setFile(null);
      if (input.current) input.current.value = ""; // 계정 이름은 남긴다 — 다음 파일에 이어 쓰게
      router.refresh();
      } catch {
        setError("서버와 연결이 어긋났습니다 — 화면을 새로고침한 뒤 다시 올려 주세요");
      }
    });
  }

  const needLabel = preview?.kind === "cash";

  return (
    <>
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">엑셀 올리기</h2>
        <p className="mt-1 text-sm text-slate-500">
          은행 거래내역 · 법인카드 이용내역(우리카드 <strong>승인 상세내역</strong>·이용대금 상세내역, 신한카드) ·
          여신협회 카드매출 · 홈택스 전자세금계산서 · 토스 포스 매출리포트(zip 그대로)를
          올리면 무엇으로 읽었는지 먼저 보여 드립니다.{" "}
          <strong>같은 파일을 또 올려도 두 번 계산되지 않습니다.</strong>
        </p>
        <input
          ref={input}
          type="file"
          accept=".xls,.xlsx,.zip"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          className="mt-3 block w-full rounded-xl border border-slate-300 p-3 text-sm"
        />
        {pending && <p className="mt-2 text-sm text-slate-500">읽는 중…</p>}
        {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">⚠️ {error}</p>}
        {doneMsg && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">
            <span>✅ {doneMsg}</span>
            {next && (
              <Link href={next.href} className="shrink-0 rounded-control bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white">
                {next.label}
              </Link>
            )}
          </div>
        )}
      </section>

      {preview && (
        <section className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-semibold">
            이렇게 읽었습니다 — <span className="text-amber-800">{preview.formatName}</span>
          </h2>
          <ul className="tabular mt-2 space-y-1 text-sm">
            <li>
              기간: {preview.periodFrom ?? "?"} ~ {preview.periodTo ?? "?"} · {preview.rowCount}줄
              {preview.skippedCount > 0 && (
                <span className="text-amber-700"> (못 읽음 {preview.skippedCount}줄)</span>
              )}
              {preview.noteCount > 0 && (
                <span className="text-slate-500"> (일부러 뺀 줄 {preview.noteCount}줄)</span>
              )}
            </li>
            {preview.kind === "cash" ? (
              <li>
                들어온 돈 <strong>{won(preview.sumIn)}원</strong> · 나간 돈{" "}
                <strong>{won(preview.sumOut)}원</strong>
                <span className="ml-1 text-xs text-slate-500">— 은행·카드 앱의 합계와 맞는지 봐 주세요</span>
              </li>
            ) : (
              <li>
                합계금액 <strong>{won(preview.sumTotal)}원</strong>
                <span className="ml-1 text-xs text-slate-500">— 홈택스 화면의 총 합계금액과 맞는지 봐 주세요</span>
              </li>
            )}
          </ul>
          {preview.skippedSample.length > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              ⚠️ 못 읽은 줄 — 봐 주세요: {preview.skippedSample.join(" / ")}
            </p>
          )}
          {/* ⭐ 까닭이 분명해 안 담은 줄 — 「못 읽음」과 갈라 놓는다 (사장님 제보 2026-08-29)
              전엔 전액 취소된 승인까지 「못 읽음」으로 세어 고장난 것처럼 보였다 */}
          {preview.noteSample.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              일부러 뺀 줄 (넣을 돈이 없어서): {preview.noteSample.join(" / ")}
            </p>
          )}
          {/* ⭐ 우리카드 두 형식 겹침 — 그대로 반영하면 같은 지출이 두 번 잡힌다 (2026-08-29) */}
          {preview.warn && (
            <p className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2 text-xs font-medium text-red-800">
              🔴 {preview.warn}
            </p>
          )}
          <table className="mt-2 w-full text-xs">
            <tbody>
              {preview.sample.map((s, i) => (
                <tr key={i} className="border-t border-amber-200">
                  <td className="tabular py-1 pr-2 text-slate-500">{s.when}</td>
                  <td className="max-w-[10rem] truncate pr-2">{s.desc}</td>
                  <td className="tabular pr-2 text-right text-emerald-700">
                    {s.inAmount !== 0 && `+${won(s.inAmount)}`}
                  </td>
                  <td className="tabular text-right text-red-600">{s.outAmount !== 0 && `−${won(s.outAmount)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {needLabel && (
            <label className="mt-3 block">
              <span className="text-sm font-medium">어느 {preview.source === "통장" ? "통장" : "카드"}인가요?</span>
              {preview.labels.length > 0 && !newLabel ? (
                <select
                  value={label}
                  onChange={(e) => {
                    if (e.target.value === "__new__") {
                      setNewLabel(true);
                      setLabel("");
                    } else setLabel(e.target.value);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-3"
                >
                  <option value="">계정 고르기…</option>
                  {preview.labels.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                  <option value="__new__">+ 새 계좌·카드…</option>
                </select>
              ) : (
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={preview.source === "통장" ? "예: 신한주거래" : "예: 국민법인카드"}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-3"
                />
              )}
              <span className="mt-1 block text-xs text-slate-500">
                전에 쓴 이름 그대로 골라 주세요 — 이름이 다르면 다른 계좌로 셉니다
              </span>
              {/* 🔴 2025 감사 F21: 같은 계좌를 다른 이름으로 올리면 2025 전량이 중복된다(검증은 최근 60일만) */}
              {newLabel && preview.labels.length > 0 && (
                <span className="mt-1 block rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  ⚠ 이미 등록된 {preview.source === "통장" ? "통장" : "카드"}이 {preview.labels.length}개 있습니다 — 같은
                  계좌를 새 이름으로 올리면 지난 내역이 통째로 두 번 들어갑니다.{" "}
                  <button type="button" className="underline" onClick={() => { setNewLabel(false); setLabel(""); }}>
                    기존 계정에서 고르기
                  </button>
                </span>
              )}
            </label>
          )}

          <button
            type="button"
            onClick={onApply}
            disabled={pending || (needLabel && label.trim() === "")}
            className="mt-3 w-full rounded-xl bg-slate-900 py-3.5 font-semibold text-white disabled:opacity-40"
          >
            이대로 반영
          </button>
        </section>
      )}
    </>
  );
}
