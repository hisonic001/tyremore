"use client";

import { useState } from "react";

/**
 * 견적서·거래명세서 A4 양식 (사장님 요청 2026-08-05)
 *
 * 원칙: 보기 좋고 쉬울 것. 공급자·구매자·품목·단가·합계가 분명할 것.
 * 금액은 공급가액·세액 분리 (사장님 선택). 도장 이미지가 있으면 이름 위에 찍는다.
 *
 * ⭐ 그 자리 수정 (사장님 요청 2026-08-08):
 *    품명·규격·수량·단가를 화면에서 바로 고치고, 줄을 더하거나 뺄 수 있다.
 *    🔴 **인쇄를 위한 수정일 뿐이다** — 저장되지 않고 정비 내역·재고·MARS 에
 *    아무 영향이 없다. 새로고침하면 원래대로 돌아온다.
 *    비고란 하나를 표 아래 둔다 — 적은 내용은 인쇄에 그대로 나온다.
 */

const won = (n: number) => n.toLocaleString("ko-KR");

/** 123,456 → 「일십이만삼천사백오십육」 — 합계 한글 표기 */
function korAmount(n: number): string {
  if (n === 0) return "영";
  const D = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  const U = ["", "십", "백", "천"];
  const B = ["", "만", "억", "조"];
  let out = "";
  let big = 0;
  while (n > 0) {
    const part = n % 10000;
    if (part > 0) {
      let s = "";
      let p = part;
      for (let u = 0; p > 0; u++) {
        const d = p % 10;
        if (d > 0) s = D[d] + U[u] + s;
        p = Math.floor(p / 10);
      }
      out = s + B[big] + out;
    }
    n = Math.floor(n / 10000);
    big++;
  }
  return out;
}

export interface PrintLine {
  description: string;
  spec: string | null;
  isService: boolean;
  qty: number;
  unitPrice: number;
}

export function PrintFrame({
  doc,
  shop,
  head,
  lines,
}: {
  doc: "estimate" | "statement";
  shop: { name: string; bizNo: string | null; owner: string | null; address: string | null; phone: string | null; stamp: string | null };
  head: {
    quoteNo: string;
    workDate: string;
    customerName: string;
    phone: string | null;
    address: string | null;
    plateNo: string | null;
    vehicle: string | null;
    paymentMethod: string | null;
    canceled: boolean;
  };
  lines: PrintLine[];
}) {
  const title = doc === "estimate" ? "견 적 서" : "거 래 명 세 서";

  /** ⭐ 인쇄용 편집 상태 — 저장되지 않는다 (사장님 요청 2026-08-08) */
  const [edit, setEdit] = useState<(PrintLine & { key: number })[]>(() =>
    lines.map((l, i) => ({ ...l, key: i })),
  );
  const [note, setNote] = useState("");
  const patch = (key: number, p: Partial<PrintLine>) =>
    setEdit((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const rows = edit.map((l) => {
    const total = l.qty * l.unitPrice;
    const supply = Math.round(total / 1.1);
    return { ...l, total, supply, vat: total - supply };
  });
  const sumTotal = rows.reduce((s, r) => s + r.total, 0);
  const sumSupply = rows.reduce((s, r) => s + r.supply, 0);
  const sumVat = sumTotal - sumSupply;

  /** 표 안에서 글자처럼 보이는 입력칸 — 인쇄하면 일반 글자와 똑같이 나온다 */
  const CELL_IN =
    "w-full bg-transparent outline-none focus:bg-amber-50 print:bg-transparent";

  return (
    <div className="min-h-dvh bg-slate-200 print:bg-white">
      {/* ⭐ 인쇄하면 위에 작게 나오던 「타이어모어」(사장님 제보 2026-08-24) — 화면 요소가
            아니라 **브라우저가 종이 여백에 찍는 머리글**(문서 제목·URL)이다. 여백을 0으로
            두면 크롬이 머리글·바닥글을 아예 안 그린다. 종이 여백은 아래 A4 div 의
            p-[12mm] 패딩이 대신한다 (그래서 print:p-0 도 함께 뗐다). */}
      <style>{`@media print { @page { size: A4; margin: 0 } }`}</style>
      {/* 화면에서만 보이는 도구 막대 */}
      <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-4 py-3 print:hidden">
        <button onClick={() => history.back()} className="text-sm text-slate-600 underline underline-offset-4">
          ← 돌아가기
        </button>
        <span className="text-xs text-amber-700">
          ✏️ 품명·수량·단가는 눌러서 고치고, [공임] 글자는 눌러서 뺄 수 있습니다 — <strong>인쇄에만 반영</strong>되고
          정비 내역은 안 바뀝니다
        </span>
        <div className="flex gap-2">
          <a
            href={`?doc=${doc === "estimate" ? "statement" : "estimate"}`}
            className="rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-medium"
          >
            {doc === "estimate" ? "거래명세서로" : "견적서로"}
          </a>
          <button onClick={() => window.print()} className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white">
            인쇄
          </button>
        </div>
      </div>

      {/* A4 종이 */}
      <div className="mx-auto max-w-[210mm] bg-white p-[12mm] text-[13px] leading-snug text-black shadow print:max-w-none print:shadow-none">
        {head.canceled && (
          <p className="mb-2 border border-red-500 p-1 text-center font-bold text-red-600 print:hidden">
            ⚠️ 취소된 판매입니다
          </p>
        )}
        <h1 className="text-center text-3xl font-bold tracking-[0.5em]">{title}</h1>

        {/* 상단 — 수신(구매자) · 공급자 */}
        <div className="mt-6 flex gap-4">
          <div className="flex-1">
            <table className="w-full border-collapse">
              <tbody>
                <Tr th="수신">{head.customerName} 귀하</Tr>
                {head.plateNo && <Tr th="차량번호">{[head.plateNo, head.vehicle].filter(Boolean).join(" · ")}</Tr>}
                {head.phone && <Tr th="연락처">{head.phone}</Tr>}
                <Tr th={doc === "estimate" ? "견적일자" : "거래일자"}>{head.workDate}</Tr>
                <Tr th="문서번호">{head.quoteNo}</Tr>
              </tbody>
            </table>
            <p className="mt-2 text-[12px]">
              {doc === "estimate" ? "아래와 같이 견적합니다." : "아래와 같이 거래 내역을 확인합니다."}
            </p>
          </div>

          <div className="w-[45%]">
            <table className="w-full border-collapse border border-black">
              <tbody>
                <tr>
                  <th rowSpan={5} className="w-7 border border-black bg-slate-100 p-1 text-center align-middle text-[12px] [writing-mode:vertical-rl]">
                    공 급 자
                  </th>
                  <th className="w-20 border border-black bg-slate-100 p-1.5 text-[12px] font-medium">등록번호</th>
                  <td className="tabular border border-black p-1.5">{shop.bizNo ?? ""}</td>
                </tr>
                <tr>
                  <th className="border border-black bg-slate-100 p-1.5 text-[12px] font-medium">상호</th>
                  <td className="border border-black p-1.5 font-semibold">{shop.name}</td>
                </tr>
                <tr>
                  <th className="border border-black bg-slate-100 p-1.5 text-[12px] font-medium">대표자</th>
                  <td className="relative border border-black p-1.5">
                    {shop.owner ?? ""} <span className="text-slate-500">(인)</span>
                    {shop.stamp && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={shop.stamp}
                        alt=""
                        className="absolute right-1 top-1/2 h-11 w-11 -translate-y-1/2 object-contain opacity-90"
                      />
                    )}
                  </td>
                </tr>
                <tr>
                  <th className="border border-black bg-slate-100 p-1.5 text-[12px] font-medium">주소</th>
                  <td className="border border-black p-1.5 text-[12px]">{shop.address ?? ""}</td>
                </tr>
                <tr>
                  <th className="border border-black bg-slate-100 p-1.5 text-[12px] font-medium">전화</th>
                  <td className="tabular border border-black p-1.5">{shop.phone ?? ""}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 합계 띠 */}
        <div className="mt-4 border-2 border-black p-2 text-center">
          <span className="font-semibold">합계금액 :</span>{" "}
          <span className="font-bold">일금 {korAmount(sumTotal)}원整</span>{" "}
          <span className="tabular">(₩{won(sumTotal)})</span>
          <span className="ml-2 text-[12px] text-slate-600">— 부가세 포함</span>
        </div>

        {/* 품목표 */}
        <table className="mt-3 w-full border-collapse border border-black">
          <thead>
            <tr className="bg-slate-100 text-[12px]">
              <th className="border border-black p-1.5 w-8">No</th>
              <th className="border border-black p-1.5">품명</th>
              <th className="border border-black p-1.5 w-24">규격</th>
              <th className="border border-black p-1.5 w-12">수량</th>
              <th className="border border-black p-1.5 w-24">단가</th>
              <th className="border border-black p-1.5 w-24">공급가액</th>
              <th className="border border-black p-1.5 w-20">세액</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td className="tabular border border-black p-1.5 text-center">{i + 1}</td>
                <td className="border border-black p-1.5">
                  <span className="flex items-center">
                    {/* ⭐ 누르면 [공임] 글자가 빠진다 — 인쇄에만 반영 (사장님 요청 2026-08-24) */}
                    {r.isService && (
                      <button
                        type="button"
                        onClick={() => patch(r.key, { isService: false })}
                        title="누르면 [공임] 표시를 뺍니다 (인쇄에만 반영)"
                        className="mr-1 shrink-0 text-[11px] text-slate-500 hover:text-red-600 hover:line-through"
                      >
                        [공임]
                      </button>
                    )}
                    <input
                      value={r.description}
                      onChange={(e) => patch(r.key, { description: e.target.value })}
                      className={CELL_IN}
                      aria-label="품명"
                    />
                  </span>
                </td>
                <td className="tabular border border-black p-1.5 text-center">
                  <input
                    value={r.spec ?? ""}
                    onChange={(e) => patch(r.key, { spec: e.target.value || null })}
                    className={`${CELL_IN} text-center`}
                    aria-label="규격"
                  />
                </td>
                <td className="tabular border border-black p-1.5 text-center">
                  <input
                    value={r.qty === 0 ? "" : String(r.qty)}
                    onChange={(e) => patch(r.key, { qty: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                    inputMode="numeric"
                    className={`${CELL_IN} text-center`}
                    aria-label="수량"
                  />
                </td>
                <td className="tabular border border-black p-1.5 text-right">
                  <input
                    value={r.unitPrice === 0 ? "" : won(r.unitPrice)}
                    onChange={(e) => patch(r.key, { unitPrice: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                    inputMode="numeric"
                    className={`${CELL_IN} text-right`}
                    aria-label="단가"
                  />
                </td>
                <td className="tabular border border-black p-1.5 text-right">{won(r.supply)}</td>
                <td className="tabular relative border border-black p-1.5 text-right">
                  {won(r.vat)}
                  {/* 줄 빼기 — 화면에서만, 종이 밖에 떠 있다 */}
                  <button
                    type="button"
                    onClick={() => setEdit((rs) => rs.filter((x) => x.key !== r.key))}
                    className="absolute -right-8 top-1/2 -translate-y-1/2 rounded px-1.5 text-slate-400 hover:text-red-600 print:hidden"
                    aria-label="이 줄 빼기"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {/* 빈 줄을 몇 개 두면 손으로 덧쓸 수 있다 */}
            {Array.from({ length: Math.max(0, 8 - rows.length) }).map((_, i) => (
              <tr key={`e${i}`}>
                {Array.from({ length: 7 }).map((__, j) => (
                  <td key={j} className="border border-black p-1.5">&nbsp;</td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-semibold">
              <td colSpan={4} className="border border-black p-1.5 text-center">합 계</td>
              <td className="border border-black p-1.5" />
              <td className="tabular border border-black p-1.5 text-right">{won(sumSupply)}</td>
              <td className="tabular border border-black p-1.5 text-right">{won(sumVat)}</td>
            </tr>
            <tr className="font-bold">
              <td colSpan={5} className="border border-black p-1.5 text-center">총 합계 (부가세 포함)</td>
              <td colSpan={2} className="tabular border border-black p-1.5 text-right text-[15px]">₩{won(sumTotal)}</td>
            </tr>
          </tfoot>
        </table>

        {/* 줄 추가 — 화면에서만 */}
        <button
          type="button"
          onClick={() =>
            setEdit((rs) => [
              ...rs,
              { key: Date.now(), description: "", spec: null, isService: false, qty: 1, unitPrice: 0 },
            ])
          }
          className="mt-2 w-full rounded-lg border border-dashed border-slate-300 py-1.5 text-sm text-slate-500 print:hidden"
        >
          + 줄 추가 (인쇄에만 반영)
        </button>

        {/* ⭐ 비고란 (사장님 요청 2026-08-08) — 적은 내용이 인쇄에 그대로 나온다 */}
        <table className="mt-3 w-full border-collapse border border-black">
          <tbody>
            <tr>
              <th className="w-16 border border-black bg-slate-100 p-1.5 text-center text-[12px] font-medium">
                비 고
              </th>
              <td className="border border-black p-1.5">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="w-full resize-none bg-transparent outline-none focus:bg-amber-50 print:bg-transparent"
                  aria-label="비고"
                />
              </td>
            </tr>
          </tbody>
        </table>

        {/* 아래 안내 */}
        <div className="mt-3 flex justify-between text-[12px] text-slate-700">
          <span>{head.paymentMethod && doc === "statement" ? `결제: ${head.paymentMethod}` : ""}</span>
          <span>{doc === "estimate" ? "본 견적서의 유효기간은 발행일로부터 7일입니다." : ""}</span>
        </div>
      </div>

      <div className="h-8 print:hidden" />
    </div>
  );
}

function Tr({ th, children }: { th: string; children: React.ReactNode }) {
  return (
    <tr>
      <th className="w-20 border border-black bg-slate-100 p-1.5 text-left text-[12px] font-medium">{th}</th>
      <td className="border border-black p-1.5">{children}</td>
    </tr>
  );
}
