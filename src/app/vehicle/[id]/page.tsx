import Link from "@/lib/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { VehicleEditForm } from "./form";
import { ToSupplier } from "./to-supplier";
import { isOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * ⭐ 고객·차량 카드 (사장님 요청 2026-08-05)
 *
 *   "고객, 차량 정보도 메인화면에서 검색 후에 고객/차량 카드로 들어가서
 *    수정이 가능했으면 좋겠음."
 *
 * 검색 결과 카드에서 들어와 이름·전화·주소·차량 정보를 고친다.
 * MARS 번호(연락처 C…, 차량 V…)는 보여만 준다 — 내보내기 열쇠라 못 고친다 (D-08).
 */
export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vehicleId = Number(id);
  if (!Number.isInteger(vehicleId)) notFound();

  const [row] = await db.execute<{
    vehicle_id: number;
    plate_no: string;
    maker_name: string | null;
    model: string | null;
    year: number | null;
    fuel_type: string | null;
    mileage: number | null;
    vin: string | null;
    v_memo: string | null;
    mars_vehicle_no: string | null;
    customer_id: number;
    name: string;
    phone: string | null;
    address: string | null;
    mars_contact_no: string | null;
    consent_privacy: boolean | null;
    consent_marketing: boolean | null;
    consent_signed: boolean;
    sale_count: number;
    last_visit: string | null;
    receivable: number;
  }>(sql`
    SELECT v.id vehicle_id, v.plate_no,
           COALESCE((SELECT name_ko FROM vehicle_maker m WHERE m.code = v.maker_code), v.maker_name) maker_name,
           v.model, v.year, v.fuel_type, v.mileage, v.vin,
           v.memo v_memo, v.mars_vehicle_no,
           c.id customer_id, c.name, c.phone, c.address, c.mars_contact_no,
           c.consent_privacy, c.consent_marketing, (c.consent_signed_at IS NOT NULL) consent_signed,
           (SELECT count(*) FROM quote q WHERE q.vehicle_id = v.id AND q.status <> '취소')::int sale_count,
           to_char(v.last_visit_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') last_visit,
           -- 이 손님의 외상 잔액 (2026-08-11) — 판매 합계 − 수금 합계
           (SELECT COALESCE(SUM(q2.total_amount - COALESCE(rp.paid, 0)), 0)::int
              FROM quote q2
              LEFT JOIN (SELECT quote_id, SUM(amount) paid FROM receivable_payment GROUP BY 1) rp
                ON rp.quote_id = q2.id
              WHERE q2.customer_id = c.id AND q2.status = '성사' AND q2.payment_method = '외상') receivable
    FROM vehicle v JOIN customer c ON c.id = v.customer_id
    WHERE v.id = ${vehicleId}
  `);
  if (!row) notFound();

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
      <Link href="/" className="text-sm text-slate-500 underline underline-offset-4">
        ← 검색으로
      </Link>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">
          {row.plate_no} <span className="text-lg font-normal text-slate-500">{row.name}</span>
        </h1>
        <div className="flex gap-2">
          <Link
            href={`/sales?vehicle=${row.vehicle_id}`}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600"
          >
            정비 이력 {Number(row.sale_count)}건
          </Link>
          <Link
            href="/sale"
            className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white"
          >
            판매 등록
          </Link>
        </div>
      </div>
      <p className="tabular mt-1 text-xs text-slate-400">
        {[
          row.mars_contact_no && `MARS 연락처 ${row.mars_contact_no}`,
          row.mars_vehicle_no && `차량 ${row.mars_vehicle_no}`,
          row.last_visit && `마지막 방문 ${row.last_visit}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        동의: 개인정보 {row.consent_privacy ? "수락" : "거부"} · 마케팅 {row.consent_marketing ? "수락" : "거부"} ·
        서명 {row.consent_signed ? "있음" : "없음"}
      </p>
      {/* ⭐ 외상 잔액 (사장님 선택 2026-08-11) — 수금은 정비 내역의 외상 카드에서 */}
      {Number(row.receivable) > 0 && (
        <p className="tabular mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          외상 잔액 {Number(row.receivable).toLocaleString()}원 —{" "}
          <Link href={`/sales?customer=${row.customer_id}&pay=외상`} className="underline underline-offset-2">
            외상 내역 보기
          </Link>
        </p>
      )}

      <VehicleEditForm
        customer={{
          customerId: Number(row.customer_id),
          name: row.name,
          phone: row.phone,
          address: row.address,
        }}
        vehicle={{
          vehicleId: Number(row.vehicle_id),
          plateNo: row.plate_no,
          makerName: row.maker_name,
          model: row.model,
          year: row.year === null ? null : Number(row.year),
          fuelType: row.fuel_type,
          mileage: row.mileage === null ? null : Number(row.mileage),
          vin: row.vin,
          memo: row.v_memo,
        }}
      />
      {/* ⭐ 거래처 차고로 보내기 (2026-09-02) — 사장님 전용 */}
      {(await isOwner()) && (
        <ToSupplier
          vehicleId={Number(row.vehicle_id)}
          plateNo={row.plate_no}
          suppliers={(
            await db.execute<{ name: string }>(sql`SELECT name FROM supplier WHERE is_active ORDER BY name LIMIT 100`)
          ).map((r) => r.name)}
        />
      )}
    </main>
  );
}
