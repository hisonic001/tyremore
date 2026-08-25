import Link from "@/lib/link";
import { cookies } from "next/headers";
import { isOwner } from "@/lib/auth";
import { pendingInvoices, supplierList } from "@/lib/invoice";
import { PendingList } from "./client";
import { RegisterPurchase } from "./register";
import { PastePurchase } from "./paste";

export const dynamic = "force-dynamic";

/**
 * 매입 입고 (2026-08-01)
 *   ① 인보이스를 올려 「입고 예정」으로 등록
 *   ② 실물이 도착하면 확정 → 재고가 된다
 */
export default async function ReceivingPage() {
  /**
   * 🔴 매입 단가는 사장님만 본다 (D-05 5번 — 2026-08-08 코드 리뷰로 구멍 발견).
   *    화면에서 감추는 것으로는 부족하다 — **서버에서 아예 빼고** 내려보낸다.
   *    입고 작업(수량·DOT·전량 입고)은 정비사도 그대로 할 수 있다.
   */
  const owner = await isOwner();
  const raw = await pendingInvoices();
  const invoices = owner
    ? raw
    : raw.map((i) => ({ ...i, lines: i.lines.map((l) => ({ ...l, unitCost: null })) }));
  const totalPending = invoices.reduce((s, i) => s + i.remain, 0);

  /**
   * ⭐ 이 기기가 담는 중인 직접 매입 장부 (사장님 지적 2026-08-06).
   *
   * 전에는 「가장 최근에 열린 직접 장부」를 열었다 — 두 사람이 같이 쓰면 한 사람이
   * 담는 동안 다른 사람도 그 장부를 봐야 했다. 이제 어느 장부를 담는 중인지는
   * 쿠키(tm_draft)로 **기기마다** 기억한다. 남의 장부는 아래 입고 예정 목록에만
   * 보이고, 「이어서 담기」를 누르면 이 기기로 가져올 수 있다.
   */
  const draftId = Number((await cookies()).get("tm_draft")?.value);
  const openManual =
    invoices.find((i) => i.invoiceId === draftId && i.invoiceNo.startsWith("직접-")) ?? null;

  /**
   * ⭐ 이 기기가 담는 중인 장부는 **아래 목록에서 뺀다** (사장님 지적 2026-08-09 —
   *    "직접매입 칸에도 타이어와 DOT 가 생기고 입고 예정에도 또 생기고… redundancy").
   *
   * 역사가 한 바퀴 돌았다: 8-05 에는 담기 화면에 확정 버튼이 없어서 장부가 갇혔고,
   * 그걸 고치느라 양쪽에 다 띄웠더니 같은 품목·같은 DOT 칸이 두 번 보였다.
   * 이제 담기 카드 안에 「입고 확정」이 있으므로 두 벌로 보여줄 이유가 없다.
   * 다른 기기의 장부는 여전히 목록에 보인다 — 「이어서 담기」로 넘겨받거나 지워야 하니까.
   */
  const listed = invoices.filter((i) => i.invoiceId !== openManual?.invoiceId);
  /** 붙여넣기 화면의 거래처 추천 — 지금까지 거래한 곳 */
  const suppliers = (await supplierList()).map((s) => s.name).slice(0, 20);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
      <Link href="/" className="text-sm text-slate-500 underline underline-offset-4">
        ← 검색으로
      </Link>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-bold">매입 입고</h1>
        {/* 지나간 매입까지 되짚는 화면 — 여기가 가장 찾기 쉬운 자리다 */}
        <Link
          href="/receiving/history"
          className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 active:bg-slate-100"
        >
          매입 내역
        </Link>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        어느 거래처 물건이든 여기서 등록합니다 — 파일이 있으면 올리고, 없으면 담습니다.
      </p>

      {/* ⭐ 등록 입구는 하나 (2026-08-04 — "중구난방" 지적). 탭으로 갈릴 뿐 결과는 같은 장부다 */}
      <RegisterPurchase openManual={openManual} owner={owner} />

      {/*
        ⭐ 붙여넣기 매입 (사장님 요청 2026-08-15) — 부품 거래처(나이스 오토파츠 등)는
           인보이스 파일을 안 준다. 주문서 화면을 복사해 붙이면 읽어서 바로 재고로.
           부품 매입이 쌓여야 안전재고 계산의 빈 곳(부품 소비량)이 메워진다.
      */}
      <PastePurchase suppliers={suppliers} />

      <section className="mt-8">
        <h2 className="font-semibold">
          입고 예정
          {totalPending > 0 && (
            <span className="tabular ml-2 rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-bold text-amber-900">
              {totalPending}본
            </span>
          )}
        </h2>
        {listed.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
            기다리는 물건이 없습니다
          </p>
        ) : (
          <PendingList invoices={listed} />
        )}
      </section>
    </main>
  );
}
