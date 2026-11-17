import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import Link from "@/lib/link";
import { hasPerm, requirePerm } from "@/lib/auth";
import { PageHeader, PageShell } from "@/components/ui/page";
import { StatusPill } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ListRow } from "@/components/ui/list-row";
import { Notice } from "@/components/ui/notice";
import { storageDetail } from "@/lib/tire-storage-data";
import { formatStorageNo } from "@/lib/tire-storage-pure";
import { formatPhone } from "@/lib/normalize";
import { shortDate } from "@/lib/tire-age";
import { StorageActions } from "./actions";

export const dynamic = "force-dynamic";

/** ⭐ 보관 세트 한 장 (D-42) — 스티커 다시 뽑기 · 찾아감 · 폐기 · 고치기 */
export default async function StorageDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  await requirePerm("sale");
  const { id } = await params;
  const sp = await searchParams;
  const sid = Number(id);
  if (!Number.isInteger(sid)) notFound();
  const d = await storageDetail(sid);
  if (!d) notFound();
  const canEdit = await hasPerm("sale_edit");
  const salesLink = (date: string) =>
    d.vehicleId ? `/sales?vehicle=${d.vehicleId}&range=range&from=${date}&to=${date}` : `/sales?customer=${d.customerId}&range=range&from=${date}&to=${date}`;

  return (
    <PageShell>
      <PageHeader title={d.no != null ? `보관 #${formatStorageNo(d.no)}` : "보관 후보"} back={{ href: "/storage", label: "보관 목록" }} />

      {sp.new === "1" && <Notice tone="success">등록했습니다. 스티커를 뽑아 타이어 묶음에 붙이고, 번호 순서 자리에 놓아 주세요.</Notice>}

      <div className="mt-3 rounded-card border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="tabular text-4xl font-extrabold tracking-tight">{formatStorageNo(d.no)}</p>
            <p className="mt-1 text-lg font-semibold">{d.describe || "내용 없음"}</p>
            {d.dot && <p className="tabular text-sm text-slate-500">DOT {d.dot}</p>}
            {d.memo && <p className="mt-1 text-sm text-slate-600">{d.memo}</p>}
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusPill tone={d.status === "보관중" ? "success" : d.status === "확인대기" ? "warn" : "neutral"}>{d.status}</StatusPill>
            {d.kind && <StatusPill tone={d.kind === "스노" ? "info" : "neutral"}>{d.kind}</StatusPill>}
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-slate-500">주인</dt>
          <dd>
            {d.vehicleId ? (
              <Link href={`/vehicle/${d.vehicleId}`} className="font-medium underline underline-offset-2">
                {d.plateNo} {d.ownerName}
              </Link>
            ) : (
              d.ownerName
            )}
            {d.supplierName && <span className="ml-1 text-xs text-slate-400">(거래처)</span>}
            {d.phone && <span className="tabular ml-2 text-slate-500">{formatPhone(d.phone)}</span>}
          </dd>
          <dt className="text-slate-500">맡긴 날</dt>
          <dd>
            {d.storedOn}
            {d.storedQuote && (
              <Link href={salesLink(d.storedQuote.workDate)} className="ml-2 text-slate-500 underline underline-offset-2">
                {d.storedQuote.no}
              </Link>
            )}
            {d.createdByName && <span className="ml-2 text-xs text-slate-400">{d.createdByName}</span>}
          </dd>
          <dt className="text-slate-500">보관료</dt>
          <dd>
            {d.storedQuote?.fee || d.releasedQuote?.fee ? (
              <span className="font-medium text-brand-700">판매에 보관료 줄 있음</span>
            ) : (
              <span className="text-slate-500">따로 안 받음 (교환 공임에 포함)</span>
            )}
          </dd>
          {d.releasedOn && (
            <>
              <dt className="text-slate-500">{d.status === "찾아감" ? "찾아간 날" : "정리한 날"}</dt>
              <dd>
                {d.releasedOn}
                {d.releasedQuote && (
                  <Link href={salesLink(d.releasedQuote.workDate)} className="ml-2 text-slate-500 underline underline-offset-2">
                    {d.releasedQuote.no}
                  </Link>
                )}
                {d.releaseNote && <span className="ml-2 text-slate-500">{d.releaseNote}</span>}
                {d.releasedByName && <span className="ml-2 text-xs text-slate-400">{d.releasedByName}</span>}
              </dd>
            </>
          )}
        </dl>
        {d.sourceText && <p className="mt-3 rounded-control bg-slate-50 p-2 text-[13px] text-slate-600">원래 판매 메모: {d.sourceText}</p>}
      </div>

      {d.no != null && d.status === "보관중" && (
        <ButtonLink href={`/print/storage?ids=${d.id}`} variant="secondary" size="lg" className="mt-3">
          <Printer className="size-5" /> 스티커 인쇄
        </ButtonLink>
      )}

      <StorageActions
        id={d.id}
        status={d.status}
        manualRelease={d.releasedQuoteId == null}
        canEdit={canEdit}
        drop={{ kind: (d.kind as "스노" | "일반" | null) ?? null, brand: d.brand ?? "", size: d.size ?? "", qty: d.qty, dot: d.dot ?? "", memo: d.memo ?? "" }}
      />

      {d.others.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-slate-500">이 손님의 다른 보관 기록</h2>
          <div className="mt-1 divide-y divide-slate-100">
            {d.others.map((o) => (
              <ListRow
                key={o.id}
                href={`/storage/${o.id}`}
                icon={<span className="tabular text-[11px] font-bold text-slate-700">{formatStorageNo(o.no)}</span>}
                title={o.describe || "내용 없음"}
                sub={`${o.plateNo ?? ""} · ${shortDate(o.storedOn)}~${o.releasedOn ? shortDate(o.releasedOn) : ""}`}
                right={<StatusPill tone={o.status === "보관중" ? "success" : "neutral"}>{o.status}</StatusPill>}
              />
            ))}
          </div>
        </section>
      )}
    </PageShell>
  );
}
