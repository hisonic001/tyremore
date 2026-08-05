"use client";

/**
 * 견적서·거래명세서 A4 양식 (사장님 요청 2026-08-05)
 *
 * 원칙: 보기 좋고 쉬울 것. 공급자·구매자·품목·단가·합계가 분명할 것.
 * 금액은 공급가액·세액 분리 (사장님 선택). 도장 이미지가 있으면 이름 위에 찍는다.
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
  const rows = lines.map((l) => {
    const total = l.qty * l.unitPrice;
    const supply = Math.round(total / 1.1);
    return { ...l, total, supply, vat: total - supply };
  });
  const sumTotal = rows.reduce((s, r) => s + r.total, 0);
  const sumSupply = rows.reduce((s, r) => s + r.supply, 0);
  const sumVat = sumTotal - sumSupply;

  return (
    <div className="min-h-dvh bg-slate-200 print:bg-white">
      {/* 화면에서만 보이는 도구 막대 */}
      <div className="mx-auto flex max-w-[210mm] items-center justify-between px-4 py-3 print:hidden">
        <button onClick={() => history.back()} className="text-sm text-slate-600 underline underline-offset-4">
          ← 돌아가기
        </button>
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
      <div className="mx-auto max-w-[210mm] bg-white p-[12mm] text-[13px] leading-snug text-black shadow print:max-w-none print:p-0 print:shadow-none">
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
              <tr key={i}>
                <td className="tabular border border-black p-1.5 text-center">{i + 1}</td>
                <td className="border border-black p-1.5">
                  {r.isService && <span className="mr-1 text-[11px] text-slate-500">[공임]</span>}
                  {r.description}
                </td>
                <td className="tabular border border-black p-1.5 text-center">{r.spec ?? ""}</td>
                <td className="tabular border border-black p-1.5 text-center">{r.qty}</td>
                <td className="tabular border border-black p-1.5 text-right">{won(r.unitPrice)}</td>
                <td className="tabular border border-black p-1.5 text-right">{won(r.supply)}</td>
                <td className="tabular border border-black p-1.5 text-right">{won(r.vat)}</td>
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
