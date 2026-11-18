import { Archive, Search } from "lucide-react";
import { requirePerm, hasPerm } from "@/lib/auth";
import { PageHeader, PageShell } from "@/components/ui/page";
import { ListRow } from "@/components/ui/list-row";
import { StatusPill } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ChipLink } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty";
import { Notice } from "@/components/ui/notice";
import { areaPins, contactRows, countSets, listAreas, listStorage, storageCounts, type StorageRow, type StorageView } from "@/lib/tire-storage-data";
import { contactKindFor, contactTargets, formatStorageNo, type StorageKind } from "@/lib/tire-storage-pure";
import { formatPhone } from "@/lib/normalize";
import { shortDate } from "@/lib/tire-age";
import { AuditList } from "./audit";
import { WarehouseCount } from "./plan/warehouse-count";
import { AreaManager } from "./plan/area-manager";
import Link from "@/lib/link";

export const dynamic = "force-dynamic";

/**
 * ⭐ 타이어 보관 (D-42, 사장님 착수 지시 2026-11-17)
 *
 *   번호 = 누구 것, 위치 = 구역 도면 위의 점 (2026-11-18 개정 — 「찾는 게 문제」). 차량번호·전화·이름·보관번호·규격으로 찾는다.
 *   탭: 📦 창고 실사(더미 단위 한 화면 — 실사·번호·위치 한 번에) · 보관 중 · 실사(내용 고치기) · 구역(도면) · 연락 명단 · 지난 기록.
 */
type Tab = "창고" | "보관중" | "실사" | "구역" | "연락" | "지난";

/** 서버는 UTC — 달은 한국 시각으로 (8/1·1/1 아침 9시 전 어긋남 방지) */
const kstMonth = () => Number(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(5, 7));

export default async function StoragePage({ searchParams }: { searchParams: Promise<{ q?: string; tab?: string; kind?: string }> }) {
  await requirePerm("sale");
  const sp = await searchParams;
  // 옛 「붙이기」 탭 주소는 창고 실사로
  const tab: Tab = (["창고", "보관중", "실사", "구역", "연락", "지난"] as const).find((t) => t === (sp.tab === "붙이기" ? "창고" : sp.tab)) ?? "보관중";
  const q = (sp.q ?? "").trim().slice(0, 40);
  const counts = await storageCounts();

  const href = (t: Tab, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ tab: t, ...extra });
    if (q && t !== "연락" && t !== "구역") p.set("q", q);
    return `/storage?${p}`;
  };

  return (
    <PageShell>
      <PageHeader
        title="타이어 보관"
        back={{ href: "/", label: "홈" }}
        action={
          <ButtonLink href="/storage/new" size="md">
            + 맡김 등록
          </ButtonLink>
        }
      />
      <p className="tabular mt-1 text-sm text-slate-500">
        보관 중 <strong className="text-slate-900">{counts.보관중}</strong>세트
        {counts.확인대기 > 0 && (
          <>
            {" "}
            · 실사 확인 남음 <strong className="text-amber-700">{counts.확인대기}</strong>
          </>
        )}
      </p>

      {/* ⭐ 스티커 모아 인쇄 (2026-11-18) — 번호 범위로 한 번에 */}
      <form action="/print/storage" target="_blank" className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-slate-600">
        스티커 모아 인쇄
        <input name="from" inputMode="numeric" placeholder="4" className="tabular w-16 rounded-control border border-slate-300 px-2 py-2" />~
        <input name="to" inputMode="numeric" placeholder="55" className="tabular w-16 rounded-control border border-slate-300 px-2 py-2" />
        <button type="submit" className="min-h-11 rounded-control border border-slate-400 bg-white px-3 font-medium text-slate-800">
          인쇄 화면
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        <ChipLink href={href("창고")} active={tab === "창고"}>
          📦 창고 실사
        </ChipLink>
        <ChipLink href={href("보관중")} active={tab === "보관중"}>
          보관 중
        </ChipLink>
        {(counts.확인대기 > 0 || tab === "실사") && (
          <ChipLink href={href("실사")} active={tab === "실사"}>
            실사 후보 {counts.확인대기}
          </ChipLink>
        )}
        <ChipLink href={href("구역")} active={tab === "구역"}>
          🗺 구역
        </ChipLink>
        <ChipLink href={href("연락")} active={tab === "연락"}>
          연락 명단
        </ChipLink>
        <ChipLink href={href("지난")} active={tab === "지난"}>
          지난 기록
        </ChipLink>
      </div>

      {tab !== "연락" && tab !== "구역" && tab !== "창고" && (
        <form action="/storage" className="mt-3 flex gap-2">
          <input type="hidden" name="tab" value={tab} />
          <input
            name="q"
            defaultValue={q}
            placeholder="차량번호 · 끝 4자리 · 전화 · 이름 · 보관번호 · 규격"
            className="min-w-0 flex-1 rounded-control border border-slate-300 bg-white px-4 py-3 text-base placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
          />
          <button type="submit" aria-label="찾기" className="flex min-h-11 w-12 items-center justify-center rounded-control bg-slate-900 text-white">
            <Search className="size-5" />
          </button>
        </form>
      )}

      {tab === "연락" ? (
        <ContactTab kind={sp.kind === "스노" || sp.kind === "일반" ? sp.kind : contactKindFor(kstMonth())} canExport={await hasPerm("customer")} />
      ) : tab === "실사" ? (
        <AuditTab q={q} />
      ) : tab === "창고" ? (
        <CountTab />
      ) : tab === "구역" ? (
        <AreaManager areas={await listAreas()} pins={await areaPins()} canEdit={await hasPerm("sale_edit")} />
      ) : (
        <ListTab view={tab === "지난" ? "지난" : "보관중"} q={q} />
      )}
    </PageShell>
  );
}

function kindPill(kind: string | null) {
  if (!kind) return null;
  return <StatusPill tone={kind === "스노" ? "info" : "neutral"}>{kind}</StatusPill>;
}

function StorageListRow({ r }: { r: StorageRow }) {
  const past = r.status !== "보관중";
  return (
    <ListRow
      href={`/storage/${r.id}`}
      icon={<span className="tabular text-[11px] font-bold text-slate-700">{formatStorageNo(r.no)}</span>}
      title={`${r.plateNo ?? "차량 없음"} · ${r.ownerName}`}
      sub={[r.areaName ? `📍${r.areaName}` : null, r.describe, r.memo].filter(Boolean).join(" · ") || "내용 없음"}
      right={past ? <StatusPill tone={r.status === "찾아감" ? "success" : "neutral"}>{r.status}</StatusPill> : kindPill(r.kind)}
      rightSub={past ? `${shortDate(r.releasedOn ?? r.storedOn)}` : `${shortDate(r.storedOn)}~`}
    />
  );
}

async function CountTab() {
  const [areas, rows] = await Promise.all([listAreas(), countSets()]);
  return (
    <WarehouseCount
      areas={areas}
      today={new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })}
      sets={rows.map((r) => ({
        id: r.id,
        no: r.no,
        status: r.status,
        plate: r.plateNo,
        owner: r.ownerName,
        describe: [r.brand, r.size, `${r.qty}본`].filter(Boolean).join(" "),
        kind: r.kind,
        areaId: r.areaId,
        x: r.pinX,
        y: r.pinY,
      }))}
    />
  );
}

async function ListTab({ view, q }: { view: StorageView; q: string }) {
  const { rows, more } = await listStorage({ view, q });
  if (!rows.length) {
    return q ? (
      <EmptyState emoji="🔍" title={`「${q}」 — ${view === "보관중" ? "보관 중인" : "지난"} 세트가 없습니다`} hint="번호판 끝 4자리나 전화번호로도 찾아보세요" />
    ) : view === "보관중" ? (
      <EmptyState
        emoji="📦"
        title="아직 등록된 보관 타이어가 없습니다"
        hint="판매 등록에서 「맡긴 타이어」를 적거나, 차량 화면의 「보관 등록」을 누르세요"
        action={<ButtonLink href="/storage/new">+ 맡김 등록</ButtonLink>}
      />
    ) : (
      <EmptyState emoji="🗂️" title="지난 기록이 없습니다" />
    );
  }
  return (
    <section className="mt-3">
      {more && <Notice tone="warn">최근 300세트까지만 보여 줍니다 — 차량번호로 찾아 주세요</Notice>}
      <div className="divide-y divide-slate-100">
        {rows.map((r) => (
          <StorageListRow key={r.id} r={r} />
        ))}
      </div>
    </section>
  );
}

async function AuditTab({ q }: { q: string }) {
  const { rows, more } = await listStorage({ view: "확인대기", q });
  return (
    <section className="mt-3">
      <Notice tone="info">
        8월부터 판매 메모에 「보관」이라고 적힌 세트입니다. 창고에서 실물을 보고 <strong>있음</strong>(번호·스티커 받음) 또는{" "}
        <strong>없음</strong>을 눌러 주세요. 메모 없이 찾은 세트는 위 「+ 맡김 등록」으로.
      </Notice>
      {more && <Notice tone="warn">300건까지만 보여 줍니다</Notice>}
      {rows.length ? (
        <AuditList rows={rows} areas={await listAreas()} pins={await areaPins()} />
      ) : (
        <EmptyState emoji="✅" title="확인할 후보가 없습니다" hint="실사가 끝났거나, 아직 후보를 만들지 않았습니다" />
      )}
    </section>
  );
}

async function ContactTab({ kind, canExport }: { kind: StorageKind; canExport: boolean }) {
  const targets = contactTargets(await contactRows(), kind);
  const withPhone = targets.filter((t) => t.phone).length;
  return (
    <section className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <ChipLink href="/storage?tab=연락&kind=스노" active={kind === "스노"}>
          스노 맡긴 손님
        </ChipLink>
        <ChipLink href="/storage?tab=연락&kind=일반" active={kind === "일반"}>
          일반 맡긴 손님
        </ChipLink>
        {canExport && targets.length > 0 && (
          <a
            href={`/storage/contacts?kind=${encodeURIComponent(kind)}`}
            className="ml-auto inline-flex min-h-11 items-center rounded-control border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700"
          >
            엑셀로 받기
          </a>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-500">
        {kind === "스노" ? "겨울 앞 — 맡겨 둔 스노 끼우러 오시라고" : "봄 — 맡겨 둔 일반 타이어로 바꾸러 오시라고"} 연락할 손님{" "}
        <strong className="text-slate-900">{targets.length}</strong>명 (전화 있는 손님 {withPhone}명) · 오래 맡긴 순
      </p>
      <Notice tone="warn">
        맡긴 타이어 안내는 서비스 연락입니다. 할인·이벤트 문구를 넣으면 광고가 되므로 <strong>마케팅 동의</strong> 손님에게만
        보내세요.
      </Notice>
      {targets.length === 0 ? (
        <EmptyState emoji="📞" title={`${kind} 타이어를 맡긴 손님이 없습니다`} />
      ) : (
        <div className="mt-2 divide-y divide-slate-100">
          {targets.map((t) => (
            <div key={t.customerId} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">
                  {t.name} <span className="text-sm font-normal text-slate-500">{t.plates.join(", ")}</span>
                </p>
                <p className="truncate text-[13px] text-slate-500">{t.sets.join(" · ")}</p>
              </div>
              <div className="shrink-0 text-right">
                {t.phone ? (
                  <a href={`tel:${t.phone}`} className="tabular block font-semibold text-brand-700 underline underline-offset-2">
                    {formatPhone(t.phone)}
                  </a>
                ) : (
                  <span className="block text-sm text-slate-400">전화 없음</span>
                )}
                <span className="block text-xs text-slate-400">
                  {shortDate(t.oldest)}~ · 마케팅 {t.consentMarketing ? "동의" : "미동의"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-slate-400">
        <Archive className="mr-1 inline size-3.5" />
        문자 자동 발송은 아직 없습니다(발신번호 등록 필요). 전화나 휴대폰 문자로 직접 연락하세요.{" "}
        <Link href="/storage?tab=보관중" className="underline">
          보관 목록
        </Link>
      </p>
    </section>
  );
}
