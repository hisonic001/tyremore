"use client";

/** 가게 정보 입력 폼 — 도장 이미지는 파일로 올려 data URL 로 저장한다 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveShopInfo, type ShopInfo } from "@/lib/shop";

const FIELD = "mt-0.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-slate-900";
const LB = "block text-xs font-medium text-slate-500";

export function ShopForm({ info }: { info: ShopInfo }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(info.name);
  const [bizNo, setBizNo] = useState(info.bizNo ?? "");
  const [owner, setOwner] = useState(info.owner ?? "");
  const [address, setAddress] = useState(info.address ?? "");
  const [phone, setPhone] = useState(info.phone ?? "");
  /** undefined = 그대로, null = 지움, string = 새 이미지 */
  const [stamp, setStamp] = useState<string | null | undefined>(undefined);

  const shownStamp = stamp === undefined ? info.stamp : stamp;

  function onStampPick(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setStamp(String(reader.result));
    reader.readAsDataURL(file);
  }

  function save() {
    start(async () => {
      setError(null);
      setMsg(null);
      const r = await saveShopInfo({ name, bizNo, owner, address, phone, stamp });
      if (!r.ok) return setError(r.error);
      setMsg("저장했습니다 — 다음 인쇄부터 반영됩니다");
      setStamp(undefined);
      router.refresh();
    });
  }

  return (
    <div className="mt-4 space-y-3">
      <label>
        <span className={LB}>상호</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className={LB}>사업자등록번호</span>
          <input value={bizNo} onChange={(e) => setBizNo(e.target.value)} placeholder="000-00-00000" className={FIELD + " tabular"} />
        </label>
        <label>
          <span className={LB}>대표자</span>
          <input value={owner} onChange={(e) => setOwner(e.target.value)} className={FIELD} />
        </label>
      </div>
      <label>
        <span className={LB}>사업장 주소</span>
        <input value={address} onChange={(e) => setAddress(e.target.value)} className={FIELD} />
      </label>
      <label>
        <span className={LB}>전화번호</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className={FIELD + " tabular"} />
      </label>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <span className={LB}>도장 이미지 (배경이 투명하거나 흰 PNG 권장)</span>
        <div className="mt-2 flex items-center gap-3">
          {shownStamp ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shownStamp} alt="도장" className="h-16 w-16 rounded border border-slate-200 bg-white object-contain" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-400">
              없음
            </div>
          )}
          <div className="space-y-1">
            <input type="file" accept="image/*" onChange={(e) => onStampPick(e.target.files?.[0] ?? null)} className="text-sm" />
            {shownStamp && (
              <button type="button" onClick={() => setStamp(null)} className="block text-xs text-red-600 underline">
                도장 지우기
              </button>
            )}
          </div>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          도장이 없으면 서류에는 이름 옆에 <strong>(인)</strong> 글자만 인쇄됩니다.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}

      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="w-full rounded-xl bg-slate-900 py-3.5 font-semibold text-white disabled:opacity-50"
      >
        {pending ? "저장 중…" : "저장"}
      </button>
    </div>
  );
}
