/**
 * 정비 내역 — 날짜별로 쭉 (사장님 요청 2026-08-04)
 *
 *   "판매 등록 후 mars와 별개로 정비내역이 시스템에 저장되고 관리되고
 *    수정되고 삭제도 가능해야함. 날짜마다 어떤 정비내역이 있는지 확인 가능해야함."
 *
 * 판매(quote)는 저장되고 있었지만 **되짚어 볼 화면이 없었다.**
 * MARS 대기열은 「아직 안 친 것」만 보여주니, 지나간 정비를 찾으려면 DB를 뒤져야 했다.
 *
 * ⚠️ 판매가는 정비사도 본다 — 손님에게 말한 금액이다.
 *    감추는 것은 매입가·마진뿐이다 (D-05). 이 화면에는 애초에 그 둘이 없다.
 *
 * 🔴 이 파일은 `"use server"` 가 아니다 (purchase-history 와 같은 이유).
 *    수정·취소 같은 쓰기는 `sale-edit.ts` 가 따로 한다.
 */
import { sql } from "drizzle-orm";
import { marsMissing } from "./mars-ready";

export interface SaleLine {
  itemId: number;
  lineType: string; // 'tire' | 'service' | 'custom'
  description: string;
  qty: number;
  finalPrice: number;
  /** ⭐ 줄별 메모 (사장님 지시 2026-08-07) — MARS 이 줄의 「설명 2」에 들어간 내용 */
  memo: string | null;
  /** ⭐ 타이어 규격 (사장님 요청 2026-08-07 — "바꾼 타이어의 사이즈도 카드에 명기") */
  spec: string | null;
  /** ⭐ 기표가 (사장님 요청 2026-08-08) — 고치기의 할인% ↔ 단가 계산 기준 */
  listPrice: number | null;
}

export interface SaleRow {
  quoteId: number;
  quoteNo: string;
  status: string; // '성사' | '취소'
  /** 실제 정비한 날 */
  workDate: string;
  customerId: number | null;
  customerName: string | null;
  /** ⭐ 대상 바꾸기가 「지금 이 차」를 알아야 한다 (2026-08-17) */
  vehicleId: number | null;
  /** ⭐ 거래처 판매면 거래처 이름 (2026-08-17) — 전에는 walkIn 에 뭉뚱그려져 있었다 */
  supplierName: string | null;
  plateNo: string | null;
  vehicleModel: string | null;
  /** ⭐ 제조사 (사장님 요청 2026-08-09 — "현대 카니발 23나1111 처럼") */
  makerName: string | null;
  /** ⭐ 그때 입력한 주행거리 (사장님 요청 2026-08-08). 없으면 차량 최근값으로 대신 보여준다 */
  mileage: number | null;
  /** 차량 카드의 최근 주행거리 — 과거 건의 대체 표시용 */
  vehicleMileage: number | null;
  /** ⭐ MARS 올리기에 모자란 필수 정보 (2026-08-17) — 비면 올릴 수 있다. 규칙은 mars-ready.ts */
  marsMissing: string[];
  /** 비회원이면 marsMemo 의 「비회원 이름 전화」가 이름 역할을 한다 (거래처는 supplierName 으로) */
  walkIn: string | null;
  totalAmount: number;
  paymentMethod: string | null;
  /** ⭐ 분할 결제 내역 (2026-08-10) — 혼합이면 수단별 금액이 여기 있다. 아니면 빈 배열 */
  payments: { method: string; amount: number; paidOn: string | null }[];
  /** ⭐ 외상 수금 이력 (2026-08-11) — 외상 건이 아니면 빈 배열 */
  collections: { id: number; amount: number; method: string; paidOn: string; memo: string | null }[];
  paymentMemo: string | null;
  marsStatus: string;
  marsRefNo: string | null;
  /** ⭐ 마지막 자동입력 시도 (단계2 mars_attempt, 카드 표시 2026-08-24) — 「MM-DD HH:MM 단계 — 오류」 */
  marsLastTry: string | null;
  /** 갈아 끼운 바퀴 (판매 등록의 체크박스) */
  tyrePositions: string[];
  /** 등록한 시각 'HH:MM' — 작업일과 별개다 */
  createdAt: string | null;
  /** ⭐ 카드 일마감 (2026-08-26): 'ok' = POS 결제와 이어짐 · 'missing' = 그 날 POS 자료는 있는데 이 건이 없음 · null = 카드 아님/POS 자료 없음 */
  posMatch: "ok" | "missing" | null;
  /** ⭐ 예약 (2026-09-01) — null(일반) | '예약중' | '시공완료' */
  reservationStatus: string | null;
  fulfilledOn: string | null;
  lines: SaleLine[];
}

/** ⭐ 그날 받은 외상 수금 한 줄 (사장님 요청 2026-09-03 — 정산한 날에도 정비내역에) */
export interface DayCollection {
  id: number;
  quoteId: number;
  quoteNo: string;
  amount: number;
  method: string;
  who: string;
  plateNo: string | null;
  /** 그 판매의 정비한 날 — 「(8/18 정비)」 표기용 */
  workDate: string;
  memo: string | null;
}

export interface SaleDay {
  date: string;
  qty: number;
  amount: number;
  sales: SaleRow[];
  /**
   * ⭐ 그날 받은 외상 수금 (2026-09-03) — 🔴 amount(매출 합계)에는 절대 안 더한다.
   *    같은 돈이 판 날과 받은 날에 두 번 잡히면 안 된다 — 별도 표기 전용.
   */
  collections: DayCollection[];
  collectedSum: number;
}

export interface SaleHistory {
  days: SaleDay[];
  totalAmount: number;
  saleCount: number;
  /** 고를 수 있는 달 ('2026-08'), 최근 순 */
  months: string[];
  /** 필터가 걸려 있으면 그 대상의 이름 (화면 제목용) */
  filterLabel: string | null;
}

/**
 * @param month    '2026-08'. 비우면 전체 기간
 * @param customerId / vehicleId  고객·차량으로 좁히기 — 카드의 「정비 이력」이 쓴다
 * @param includeCanceled  취소된 것도 볼 것인가 (기본 false)
 */
export async function saleHistory(opts: {
  month?: string;
  /** 날짜 구간 (YYYY-MM-DD) — 오늘 보기·기간 직접 지정이 쓴다 (사장님 요청 2026-08-05) */
  from?: string;
  to?: string;
  customerId?: number;
  vehicleId?: number;
  /** ⭐ 거래처로 좁히기 (2026-08-17) — 외상 장부의 「내역 보기」가 이걸로 들어온다 */
  supplierName?: string;
  includeCanceled?: boolean;
  /** ⭐ 결제 방법으로 좁히기 (사장님 요청 2026-08-07) */
  paymentMethod?: string;
  /** ⭐ 예약중만 보기 (예약거래 2026-09-01) */
  reserved?: boolean;
}): Promise<SaleHistory> {
  const { db } = await import("@/db");
  const m = opts.month && /^\d{4}-\d{2}$/.test(opts.month) ? opts.month : null;
  const okDay = (x?: string) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  const from = okDay(opts.from);
  const to = okDay(opts.to);

  const monthRows = await db.execute<{ m: string }>(sql`
    SELECT DISTINCT to_char(COALESCE(q.work_date, q.created_at::date), 'YYYY-MM') m
    FROM quote q ORDER BY 1 DESC
  `);

  /**
   * 🔴 가져오는 양을 SQL 에서부터 자른다 (2026-08-11 무한로딩 사건).
   *
   * 8/7 에는 「카드 3천 장을 그리다 폰이 얼어붙는」 것만 막았는데(화면 200장 컷),
   * 서버는 여전히 전체 기간 3,200건 × 품목 줄을 통째로 실어 날랐다. 그 큰 응답을
   * 받다가 화면을 떠나면 질의가 좀비(active·ClientRead)로 남아 풀러 자리를 깔고
   * 앉는다 — 오늘 그걸로 다시 전면 마비가 왔다. 이제 **최근 240건의 id 만 먼저
   * 고르고 상세는 그 id 들만** 가져온다. 합계·건수는 아래 가벼운 집계가 전체 기준.
   */
  const conds = sql`
    ${opts.includeCanceled ? sql`` : sql`AND q.status <> '취소'`}
    ${m ? sql`AND to_char(COALESCE(q.work_date, q.created_at::date), 'YYYY-MM') = ${m}` : sql``}
    ${from ? sql`AND COALESCE(q.work_date, q.created_at::date) >= ${from}::date` : sql``}
    ${to ? sql`AND COALESCE(q.work_date, q.created_at::date) <= ${to}::date` : sql``}
    ${opts.customerId ? sql`AND q.customer_id = ${opts.customerId}` : sql``}
    ${opts.vehicleId ? sql`AND q.vehicle_id = ${opts.vehicleId}` : sql``}
    ${opts.supplierName ? sql`AND q.supplier_name = ${opts.supplierName}` : sql``}
    ${
      opts.paymentMethod
        ? // ⭐ 분할 결제도 걸린다 (2026-08-10) — 「카드」로 거르면 카드가 섞인 혼합 건도 나온다
          sql`AND (q.payment_method = ${opts.paymentMethod}
               OR EXISTS (SELECT 1 FROM quote_payment px WHERE px.quote_id = q.id AND px.method = ${opts.paymentMethod}))`
        : sql``
    }
    ${opts.reserved ? sql`AND q.reservation_status = '예약중'` : sql``}
  `;
  /**
   * 🔴 질의는 **하나씩 차례로** (2026-08-11 2차 마비).
   *    Promise.all 로 동시에 쏘자 트랜잭션 풀러에서 전송이 꼬여
   *    ClientRead 좀비가 됐다 — 같은 질의가 순차로는 수십 ms 다.
   */
  const FETCH_CAP = 240;
  const idRows = await db.execute<{ id: number }>(sql`
    SELECT q.id FROM quote q
    WHERE 1=1 ${conds}
    ORDER BY COALESCE(q.work_date, q.created_at::date) DESC, q.id DESC
    LIMIT ${FETCH_CAP}
  `);
  // 합계·건수는 전체 기간 기준 그대로 (취소 제외) — 상세를 안 가져와도 숫자는 맞아야 한다
  const agg = await db.execute<{ n: number; amt: string }>(sql`
    SELECT count(*)::int n, COALESCE(SUM(q.total_amount), 0)::bigint amt
    FROM quote q
    WHERE q.status <> '취소' ${conds}
  `);
  const ids = idRows.map((r) => Number(r.id));

  const rows = await db.execute<{
    quote_id: number;
    quote_no: string;
    status: string;
    work_date: string;
    customer_id: number | null;
    customer_name: string | null;
    vehicle_id: number | null;
    supplier_name: string | null;
    plate_no: string | null;
    vehicle_model: string | null;
    maker_name: string | null;
    mileage: number | null;
    veh_mileage: number | null;
    veh_year: number | null;
    fuel_type: string | null;
    mars_vehicle_no: string | null;
    mars_contact_no: string | null;
    cust_phone: string | null;
    cust_address: string | null;
    consent_signed: boolean | null;
    mars_memo: string | null;
    total_amount: number;
    payment_method: string | null;
    payment_memo: string | null;
    mars_status: string;
    mars_ref_no: string | null;
    mars_last_try: string | null;
    item_id: number | null;
    line_type: string | null;
    description: string | null;
    qty: number | null;
    final_price: number | null;
    line_memo: string | null;
    spec: string | null;
    list_price: number | null;
    tyre_positions: string | null;
    reservation_status: string | null;
    fulfilled_on: string | null;
    created_hm: string | null;
    pos_n: number;
    pos_day_n: number;
    pay_split: string | null;
    collections: { id: number; amount: number; method: string; paid_on: string; memo: string | null }[] | null;
  }>(sql`
    SELECT q.id quote_id, q.quote_no, q.status,
           -- 분할 결제 「카드:30000,현금:5000」 (2026-08-10) — 수단 이름에는 콜론·쉼표가 없다
           -- 세 번째 칸 = 받은 날 (예약거래 2026-09-01, 비면 작업일 해석)
           (SELECT string_agg(pm.method || ':' || pm.amount || ':' || COALESCE(to_char(pm.paid_on, 'YYYY-MM-DD'), ''), ',' ORDER BY pm.id)
              FROM quote_payment pm WHERE pm.quote_id = q.id) pay_split,
           -- 외상 수금 이력 (2026-08-11) — 메모까지 필요해서 JSON 으로 싣는다
           (SELECT json_agg(json_build_object('id', rp.id, 'amount', rp.amount, 'method', rp.method,
                                              'paid_on', to_char(rp.paid_on, 'YYYY-MM-DD'), 'memo', rp.memo)
                            ORDER BY rp.id)
              FROM receivable_payment rp WHERE rp.quote_id = q.id) collections,
           to_char(COALESCE(q.work_date, q.created_at::date), 'YYYY-MM-DD') work_date,
           q.customer_id, c.name customer_name, q.vehicle_id, q.supplier_name,
           v.plate_no, v.model vehicle_model,
           -- 제조사는 코드 사전의 한글 이름 우선 (customer-edit 와 같은 규칙, 2026-08-09)
           COALESCE(mk.name_ko, v.maker_name) maker_name,
           q.mileage, v.mileage veh_mileage,
           -- ⭐ MARS 필수 정보 검사 재료 (사장님 지시 2026-08-17 — mars-ready.ts)
           v.year veh_year, v.fuel_type, v.mars_vehicle_no,
           c.mars_contact_no, c.phone cust_phone, c.address cust_address,
           (c.consent_signed_at IS NOT NULL) consent_signed,
           q.mars_memo, q.total_amount, q.payment_method, q.payment_memo,
           q.mars_status, q.mars_ref_no, q.tyre_positions,
           q.reservation_status, to_char(q.fulfilled_on, 'YYYY-MM-DD') fulfilled_on,
           -- ⭐ 마지막 자동입력 시도 (2026-08-24) — 어디까지 갔고 왜 멈췄는지 카드에서 보인다
           (SELECT to_char(COALESCE(a.finished_at, a.started_at) AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI')
                   || ' ' || a.stage || COALESCE(' — ' || left(a.error, 140), '')
              FROM mars_attempt a WHERE a.quote_id = q.id ORDER BY a.id DESC LIMIT 1) mars_last_try,
           to_char(q.created_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') created_hm,
           -- ⭐ 카드 일마감 자국 (2026-08-26) — 이 판매(단일·분할·외상수금)가 POS 결제와 이어졌나 / 그 날 POS 자료가 있나
           -- 🔴 2026-08-29: 외상 카드수금(receivable_payment)이 빠져 있어, 일마감에서 이어졌는데도
           --    「POS에 없음」으로 보이던 것을 고쳤다
           (SELECT count(*)::int FROM recon_match m WHERE m.kind = '포스결제' AND m.status = '확정'
              AND ((m.ref_table = 'quote' AND m.ref_id = q.id)
                OR (m.ref_table = 'quote_payment' AND m.ref_id IN (SELECT id FROM quote_payment WHERE quote_id = q.id))
                OR (m.ref_table = 'receivable_payment' AND m.ref_id IN (SELECT id FROM receivable_payment WHERE quote_id = q.id)))) pos_n,
           (SELECT count(*)::int FROM pos_txn p WHERE p.is_active AND p.day = COALESCE(q.work_date, q.created_at::date)) pos_day_n,
           qi.id item_id, qi.line_type, qi.description, qi.qty, qi.final_price, qi.memo line_memo,
           -- ⭐ 규격은 저장된 폭/편평비/인치로 조립한다 (225/45R17 · 145R13)
           --    편평비 80 은 생략 (사장님 지시 2026-08-08 — 145R13·195R15 가 익숙하다)
           CASE WHEN p.width IS NOT NULL AND p.rim_inch IS NOT NULL THEN
             p.width::text || COALESCE('/' || NULLIF(p.aspect_ratio, 80)::text, '')
               || 'R' || regexp_replace(p.rim_inch::text, '\.0$', '')
           END AS spec,
           p.list_price
    FROM quote q
    LEFT JOIN customer      c  ON c.id = q.customer_id
    LEFT JOIN vehicle       v  ON v.id = q.vehicle_id
    LEFT JOIN vehicle_maker mk ON mk.code = v.maker_code
    LEFT JOIN quote_item    qi ON qi.quote_id = q.id
    LEFT JOIN product       p  ON p.id = qi.product_id
    WHERE q.id IN ${sql.raw(`(${ids.length ? ids.join(",") : "0"})`)}
    ORDER BY COALESCE(q.work_date, q.created_at::date) DESC, q.id DESC, qi.id
  `);

  const map = new Map<number, SaleRow>();
  for (const r of rows) {
    const id = Number(r.quote_id);
    let s = map.get(id);
    if (!s) {
      s = {
        quoteId: id,
        quoteNo: r.quote_no,
        status: r.status,
        workDate: r.work_date,
        customerId: r.customer_id === null ? null : Number(r.customer_id),
        customerName: r.customer_name,
        vehicleId: r.vehicle_id === null ? null : Number(r.vehicle_id),
        supplierName: r.supplier_name,
        plateNo: r.plate_no,
        vehicleModel: r.vehicle_model,
        makerName: r.maker_name,
        mileage: r.mileage === null ? null : Number(r.mileage),
        vehicleMileage: r.veh_mileage === null ? null : Number(r.veh_mileage),
        /**
         * ⭐ MARS 에 올리기에 모자란 필수 정보 (사장님 지시 2026-08-17).
         *    앱 등록은 자유 — 검사는 MARS 올리기 문턱에서만. 규칙은 mars-ready.ts 한 곳.
         */
        marsMissing: marsMissing({
          hasVehicle: r.vehicle_id !== null,
          marsVehicleNo: r.mars_vehicle_no,
          makerName: r.maker_name,
          model: r.vehicle_model,
          year: r.veh_year === null ? null : Number(r.veh_year),
          fuelType: r.fuel_type,
          mileage: r.mileage ?? r.veh_mileage ?? null,
          contactNo: r.mars_contact_no,
          customerName: r.customer_name,
          phone: r.cust_phone,
          address: r.cust_address,
          consentSigned: r.consent_signed === true,
        }),
        /**
         * 「비회원 …」 판매는 marsMemo 가 이름 역할을 한다.
         * ⭐ 거래처는 2026-08-17 부터 supplierName 컬럼이 맡는다 — 여기서 뺀다.
         *    (옛 건은 백필해 두었다)
         */
        walkIn: r.mars_memo?.startsWith("비회원") ? r.mars_memo : null,
        totalAmount: Number(r.total_amount),
        paymentMethod: r.payment_method,
        payments: r.pay_split
          ? r.pay_split.split(",").map((x) => {
              const [method, amt, on] = x.split(":");
              return { method, amount: Number(amt), paidOn: on || null };
            })
          : [],
        paymentMemo: r.payment_memo,
        collections: (r.collections ?? []).map((c) => ({
          id: Number(c.id),
          amount: Number(c.amount),
          method: c.method,
          paidOn: c.paid_on,
          memo: c.memo,
        })),
        marsStatus: r.mars_status,
        reservationStatus: r.reservation_status,
        fulfilledOn: r.fulfilled_on,
        marsRefNo: r.mars_ref_no,
        marsLastTry: r.mars_last_try,
        tyrePositions: r.tyre_positions ? r.tyre_positions.split(",").map((x) => x.trim()).filter(Boolean) : [],
        createdAt: r.created_hm,
        posMatch:
          r.payment_method === "카드" ||
          r.payment_method === "간편결제" ||
          (r.pay_split ?? "").includes("카드:") ||
          (r.pay_split ?? "").includes("간편결제:")
            ? Number(r.pos_n) > 0
              ? "ok"
              : Number(r.pos_day_n) > 0
                ? "missing"
                : null
            : null,
        lines: [],
      };
      map.set(id, s);
    }
    if (r.item_id !== null) {
      s.lines.push({
        itemId: Number(r.item_id),
        lineType: r.line_type ?? "custom",
        description: r.description ?? "",
        qty: Number(r.qty ?? 0),
        finalPrice: Number(r.final_price ?? 0),
        memo: r.line_memo,
        // 규격이 이름에 이미 적혀 있으면(백필 원본명 등) 겹쳐 쓰지 않는다
        spec: r.spec && !(r.description ?? "").includes(r.spec) ? r.spec : null,
        listPrice: r.list_price === null ? null : Number(r.list_price),
      });
    }
  }

  const dayMap = new Map<string, SaleDay>();
  const dayOf = (date: string) =>
    dayMap.get(date) ??
    dayMap.set(date, { date, qty: 0, amount: 0, sales: [], collections: [], collectedSum: 0 }).get(date)!;
  for (const s of map.values()) {
    const d = dayOf(s.workDate);
    d.sales.push(s);
    if (s.status !== "취소") {
      d.qty += s.lines.filter((l) => l.lineType === "tire").reduce((n, l) => n + l.qty, 0);
      d.amount += s.totalAmount;
    }
  }

  /**
   * ⭐ 외상 수금을 「받은 날」 그룹에 싣는다 (사장님 요청 2026-09-03).
   * 🔴 매출 합계(d.amount·totalAmount)에는 절대 안 더한다 — 판 날에 이미 세었다.
   *    수금 정본은 receivable_payment 그대로(외상 장부와 같은 표), 새 판정 없음.
   *    수금만 있고 판매가 없는 날도 그룹이 생긴다. 예약중 필터에선 생략.
   */
  if (!opts.reserved) {
    const colls = await db.execute<{
      id: number;
      quote_id: number;
      quote_no: string;
      amount: number;
      method: string;
      paid_on: string;
      memo: string | null;
      who: string;
      plate_no: string | null;
      work_date: string;
    }>(sql`
      SELECT rp.id, q.id quote_id, q.quote_no, rp.amount, rp.method,
             to_char(rp.paid_on, 'YYYY-MM-DD') paid_on, rp.memo,
             COALESCE(q.supplier_name, c.name, '손님') who, v.plate_no,
             to_char(COALESCE(q.work_date, q.created_at::date), 'YYYY-MM-DD') work_date
      FROM receivable_payment rp
      JOIN quote q ON q.id = rp.quote_id
      LEFT JOIN customer c ON c.id = q.customer_id
      LEFT JOIN vehicle v ON v.id = q.vehicle_id
      WHERE q.status = '성사' AND q.payment_method = '외상'
        ${m ? sql`AND to_char(rp.paid_on, 'YYYY-MM') = ${m}` : sql``}
        ${from ? sql`AND rp.paid_on >= ${from}::date` : sql``}
        ${to ? sql`AND rp.paid_on <= ${to}::date` : sql``}
        ${opts.customerId ? sql`AND q.customer_id = ${opts.customerId}` : sql``}
        ${opts.vehicleId ? sql`AND q.vehicle_id = ${opts.vehicleId}` : sql``}
        ${opts.supplierName ? sql`AND q.supplier_name = ${opts.supplierName}` : sql``}
      ORDER BY rp.paid_on DESC, rp.id DESC
      LIMIT 300
    `);
    for (const r of colls) {
      const d = dayOf(r.paid_on);
      d.collections.push({
        id: Number(r.id),
        quoteId: Number(r.quote_id),
        quoteNo: r.quote_no,
        amount: Number(r.amount),
        method: r.method,
        who: r.who,
        plateNo: r.plate_no,
        workDate: r.work_date,
        memo: r.memo,
      });
      d.collectedSum += Number(r.amount);
    }
  }

  // 필터 대상의 이름 — 화면 제목에 「이 손님의 정비 이력」이라고 보여 준다
  let filterLabel: string | null = null;
  if (opts.vehicleId) {
    const [v] = await db.execute<{ plate_no: string; name: string | null }>(sql`
      SELECT v.plate_no, c.name FROM vehicle v LEFT JOIN customer c ON c.id = v.customer_id
      WHERE v.id = ${opts.vehicleId}`);
    if (v) filterLabel = `${v.plate_no}${v.name ? ` · ${v.name}` : ""}`;
  } else if (opts.customerId) {
    const [c] = await db.execute<{ name: string }>(sql`
      SELECT name FROM customer WHERE id = ${opts.customerId}`);
    if (c) filterLabel = c.name;
  } else if (opts.supplierName) {
    // 질의 없이 그대로 — 거래처 이름은 quote 에 그 글자로 들어 있다
    filterLabel = `거래처 ${opts.supplierName}`;
  }

  return {
    days: [...dayMap.values()].sort((a, b) => b.date.localeCompare(a.date)),
    // 전체 기간 기준 집계 — 상세는 최근 240건만 가져와도 이 숫자는 전체다 (2026-08-11)
    totalAmount: Number(agg[0]?.amt ?? 0),
    saleCount: Number(agg[0]?.n ?? 0),
    months: monthRows.map((r) => r.m),
    filterLabel,
  };
}
