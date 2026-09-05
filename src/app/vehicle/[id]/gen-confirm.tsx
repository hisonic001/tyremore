"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import Link from "@/lib/link";
import { Button } from "@/components/ui/button";
import { confirmVehicleGeneration } from "@/lib/spec";

/**
 * ⭐ 세대 확인 유도 (2026-09-05, /carinfo 도입 2단계)
 *
 *   세대를 모르는 차는 제원 블록이 조용히 사라졌다 — 왜 안 나오는지, 뭘 하면
 *   나오는지 아무도 몰랐다. 여기서 세대를 확정하면 이 차에 제원·부품이 붙는다.
 * 🔴 확정은 사람이 한다 — 차대번호 제안(같은 앞자리에서 배움)은 제안일 뿐이다.
 */
export function GenConfirm({
  vehicleId,
  model,
  vin,
  suggestion,
  gens,
}: {
  vehicleId: number;
  model: string | null;
  vin: string | null;
  suggestion: { variantKey: string; label: string; support: number } | null;
  gens: { variantKey: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const save = (variantKey: string) => {
    start(async () => {
      setErr(null);
      const r = await confirmVehicleGeneration(vehicleId, variantKey);
      if (!r.ok) return setErr(r.error);
      router.refresh();
    });
  };

  return (
    <div className="mt-2">
      <p className="text-[13px] leading-snug text-slate-500">
        이 차{model ? `(${model})` : ""}는 아직 <strong>어느 세대인지 확정되지 않아</strong> 순정
        제원·맞는 부품이 안 보입니다. 세대를 확인해 주시면 그때부터 이 화면에 붙습니다.
      </p>

      {suggestion && (
        <div className="mt-2 rounded-control bg-sky-50 px-3 py-2">
          <p className="text-[13px] text-sky-900">
            차대번호 앞자리가 같은 우리 차 {suggestion.support}대가 전부 <strong>{suggestion.label}</strong>
            였습니다 — 이 세대로 보입니다.
          </p>
          <Button className="mt-1.5" pending={pending} onClick={() => save(suggestion.variantKey)}>
            <Check className="size-4" /> 맞습니다 — {suggestion.label}
          </Button>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
        >
          <option value="">세대 직접 고르기…</option>
          {gens.map((g) => (
            <option key={g.variantKey} value={g.variantKey}>
              {g.label}
            </option>
          ))}
        </select>
        <Button variant="secondary" pending={pending} disabled={!sel} onClick={() => sel && save(sel)}>
          이 세대로 확정
        </Button>
        {vin && (
          <Link href={`/carinfo?vin=${encodeURIComponent(vin)}`} className="text-[13px] text-slate-500 underline underline-offset-4">
            정비 조회에서 자세히 보기
          </Link>
        )}
      </div>

      {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
    </div>
  );
}
