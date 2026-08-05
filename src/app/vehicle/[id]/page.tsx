import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { VehicleEditForm } from "./form";

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
    mileage: number | null;
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
  }>(sql`
    SELECT v.id vehicle_id, v.plate_no, v.maker_name, v.model, v.year, v.mileage,
           v.memo v_memo, v.mars_vehicle_no,
           c.id customer_id, c.name, c.phone, c.address, c.mars_contact_no,
           c.consent_privacy, c.consent_marketing, (c.consent_signed_at IS NOT NULL) consent_signed,
           (SELECT count(*) FROM quote q WHERE q.vehicle_id = v.id AND q.status <> '취소')::int sale_count,
           to_char(v.last_visit_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') last_visit
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
        <h1 className="text-2xl font-bold">
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
          mileage: row.mileage === null ? null : Number(row.mileage),
          memo: row.v_memo,
        }}
      />
    </main>
  );
}
