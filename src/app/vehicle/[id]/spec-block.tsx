import Link from "@/lib/link";
import { BookMarked } from "lucide-react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { partsForGeneration } from "@/lib/parts-fit";
import { SpecSheetView } from "@/components/spec/sheet";
import { buildSpecSheet } from "@/lib/spec-sheet-core";
import { listSpecGenerations, specsForVehicle } from "@/lib/spec";
import { guessGenerationByVin } from "@/lib/vin-learn";
import { GenConfirm } from "./gen-confirm";

/**
 * 이 차의 순정 제원 (D-04 3차 개정, 2026-09-03)
 *
 * 🔴 **확인된 값만 나온다.** 검수 전 값은 여기 아예 안 온다 (lib/spec.ts 에서 걸러진다).
 * 🔴 **세대를 모르는 차에는 아무것도 안 보여준다.** 그냥 「쏘렌토」라고만 적힌 차에
 *    비슷한 쏘렌토의 값을 붙이면, 3세대 차에 4세대 공기압이 뜬다.
 *    비어 있는 것이 틀린 값보다 낫다 — 그래서 조용히 아무것도 안 그린다.
 */
export async function VehicleSpecBlock({ vehicleId }: { vehicleId: number }) {
  const spec = await specsForVehicle(vehicleId);
  if (!spec) {
    /**
     * ⭐ 세대 미상이면 조용히 사라지는 대신 **확인을 유도한다** (2026-09-05, 도입 2단계).
     *    확인할수록 제원 보이는 차가 늘어난다. 질의는 순차.
     */
    const [v] = await db.execute<{ model: string | null; vin: string | null }>(sql`
      SELECT model, vin FROM vehicle WHERE id = ${vehicleId}`);
    if (!v) return null;
    const guess = v.vin ? await guessGenerationByVin(v.vin) : null;
    const gens = await listSpecGenerations();
    return (
      <section className="mt-5 rounded-card border border-slate-200 bg-white p-4">
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-slate-900">
          <BookMarked className="size-4 text-slate-400" /> 순정 제원
        </h2>
        <GenConfirm
          vehicleId={vehicleId}
          model={v.model}
          vin={v.vin}
          suggestion={guess ? { variantKey: guess.variantKey, label: guess.label, support: guess.support } : null}
          gens={gens.map((g) => ({ variantKey: g.variantKey, label: g.label }))}
        />
      </section>
    );
  }
  /* 🔴 질의는 순차로 (2026-08-11 풀 만석 사고 이후 Promise.all 안 쓴다) */
  const parts = spec.generationId ? await partsForGeneration(spec.generationId) : [];

  const nothingApproved = spec.groups.length === 0;

  const sheet = buildSpecSheet({
    label: spec.label,
    variantKey: spec.variantKey,
    manualUrl: spec.manualUrl,
    rows: spec.groups.flatMap((g) =>
      g.rows.map((r) => ({
        id: null,
        item: r.item,
        label: r.label,
        shown: r.shown,
        hidden: false,
        locked: r.locked,
        qualifier: r.qualifier,
        groupNo: g.groupNo,
        groupLabel: g.groupLabel,
        status: "승인" as const,
      })),
    ),
    parts,
  });

  return (
    <section className="mt-5 rounded-card border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-slate-900">
          <BookMarked className="size-4 text-slate-400" /> 순정 제원
          <span className="text-[13px] font-normal text-slate-500">{spec.label}</span>
        </h2>
        {spec.manualUrl && (
          <a
            href={spec.manualUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[12px] text-sky-700 underline underline-offset-4"
          >
            제조사 설명서
          </a>
        )}
      </div>

      {nothingApproved && parts.length === 0 ? (
        <p className="mt-2 text-[13px] text-slate-500">
          {spec.waiting > 0 ? (
            <>
              설명서에서 받아 온 값 {spec.waiting}개가 <strong>사장님 확인을 기다립니다</strong> —{" "}
              <Link href={`/settings/spec?gen=${encodeURIComponent(spec.variantKey)}`} className="underline underline-offset-2">
                확인하러 가기
              </Link>
            </>
          ) : (
            "아직 받아 온 제원이 없습니다."
          )}
        </p>
      ) : (
        <>
          {/* 🔴 검수 화면과 **같은 부품**으로 그린다 — 셋이 갈라지면 어느 게 맞는지 모른다 */}
          <SpecSheetView sheet={sheet} />
          {spec.waiting > 0 && (
            <p className="mt-2 text-[12px] text-slate-400">
              확인을 기다리는 값이 {spec.waiting}개 더 있습니다 —{" "}
              <Link href={`/settings/spec?gen=${encodeURIComponent(spec.variantKey)}`} className="underline underline-offset-2">
                확인하기
              </Link>
            </p>
          )}
        </>
      )}

      <p className="mt-3 text-[11px] leading-snug text-slate-400">
        제조사 취급설명서에서 그대로 옮긴 값입니다. 실제 차에 붙은 타이어·휠이 순정과 다를 수 있으니
        <strong> 운전석 문틀 라벨</strong>도 함께 봐 주세요.
      </p>
    </section>
  );
}
