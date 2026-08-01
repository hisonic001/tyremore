/**
 * 엑셀 → DB 행 변환 (순수 함수)
 *
 * DB 접속 없이 전부 검증할 수 있게 일부러 분리했다.
 *   npx tsx scripts/import/run-all.ts --dry-run
 * 이 단계에서 건수·이상치가 다 드러나므로, DB 쓰기는 마지막에 한 번만 하면 된다.
 */
import { findFile, openWorkbook, readSheet, type Row } from "../lib/excel";
import {
  isPlausibleDot,
  normalizeName,
  normalizePhone,
  normalizePlate,
  parseDotColumn,
  splitNameMemo,
  toInt,
  toText,
} from "../../src/lib/normalize";
import { parseTireAttrs } from "../../src/lib/tire-attrs";
import { parseTireSpec } from "../../src/lib/tire-spec";
import { resolveBrand, resolveMaker } from "./seed-data";
import { SERVICE_RULES } from "./service-rules";

export interface Issue {
  kind: string;
  refTable: string;
  rawValue: string | null;
  suggestion: string | null;
  detail: string | null;
}

export interface Transformed<T> {
  rows: T[];
  issues: Issue[];
}

/* ============================================================
 * 4. product — 타이어·부품 마스터 (MARS 상품 10,691건)
 * ========================================================== */
export interface ProductRow {
  marsItemNo: string;
  itemType: "tire" | "part";
  isSerialized: boolean;
  brandCode: string | null;
  pattern: string | null;
  rawName: string;
  width: number | null;
  aspectRatio: number | null;
  rimInch: string | null;
  loadIndex: string | null;
  speedRating: string | null;
  season: string | null;
  isRunflat: boolean;
  isAcoustic: boolean;
  isSuv: boolean;
  category: string | null;
  barcode: string | null;
  /** MARS 「단가1」 원본 — VAT 미포함. 화면용 list_price 는 적재 단계에서 만든다 */
  listPriceExcl: number | null;
  supplierCode: string | null;
  specParsed: boolean;
}

export function transformProducts(dataDir: string): Transformed<ProductRow> {
  const wb = openWorkbook(findFile(dataDir, "상품 MARS"));
  const { rows: src } = readSheet(wb, "상품");
  const rows: ProductRow[] = [];
  const issues: Issue[] = [];
  const seen = new Set<string>();

  for (const r of src) {
    const marsItemNo = toText(r["번호"]);
    const rawName = toText(r["상세 항목 및 서비스"]);
    if (!marsItemNo || !rawName) continue;

    if (seen.has(marsItemNo)) {
      issues.push({
        kind: "dup_product",
        refTable: "product",
        rawValue: marsItemNo,
        suggestion: null,
        detail: `상품 번호 중복: ${rawName}`,
      });
      continue;
    }
    seen.add(marsItemNo);

    const category = toText(r["품목 범주 코드"]);
    const isTire = category === "10-TIRES";
    const spec = isTire ? parseTireSpec(rawName) : null;
    /**
     * ⚠️ 속성 판정은 「설명 2」(모델명)로 한다. 「상세 항목 및 서비스」에는 모델명이 없다.
     *    1차 이관에서 이걸 놓쳐 10,318건 중 3건만 계절이 분류됐다 (2026-08-01 발견).
     */
    const attrs = isTire
      ? parseTireAttrs(toText(r["설명 2"]), rawName)
      : { season: null, isRunflat: false, isAcoustic: false, isSuv: false };

    if (isTire && !spec!.parsed) {
      issues.push({
        kind: "spec_parse",
        refTable: "product",
        rawValue: rawName,
        suggestion: null,
        detail: `규격 파싱 실패 (품번 ${marsItemNo})`,
      });
    }

    rows.push({
      marsItemNo,
      itemType: isTire ? "tire" : "part",
      isSerialized: isTire, // 타이어는 1본 1행, 부품은 1행에 수량
      // ⚠️ MARS 는 BFGoodrich 를 미쉐린으로 분류해 놓았다. 여기서 바로잡는다
      brandCode: resolveBrand(toText(r["제조사 코드"]), toText(r["설명 2"])),
      pattern: toText(r["설명 2"]),
      rawName,
      width: spec?.width ?? null,
      aspectRatio: spec?.aspectRatio ?? null,
      rimInch: spec?.rimInch !== null && spec?.rimInch !== undefined ? String(spec.rimInch) : null,
      loadIndex: spec?.loadIndex ?? null,
      speedRating: spec?.speedRating ?? null,
      season: attrs.season,
      isRunflat: attrs.isRunflat,
      isAcoustic: attrs.isAcoustic,
      isSuv: attrs.isSuv,
      category,
      barcode: toText(r["제조사 품목 번호"]),
      /**
       * ⭐ 단가1 이 기표가다. 「단가」가 아니다 (D-09).
       * ⚠️ 이 값은 **VAT 미포함**이다 (2026-08-01 확인).
       *    원본 그대로 넣고, VAT는 적재 단계에서 브랜드 설정에 따라 붙인다.
       *    여기서 곱해 버리면 브랜드별로 다르게 처리할 수 없다.
       */
      listPriceExcl: toInt(r["단가1"]),
      supplierCode: toText(r["매입처 번호"]),
      specParsed: spec?.parsed ?? false,
    });
  }
  return { rows, issues };
}

/* ============================================================
 * 3. service_item — 패스트핏 서비스 69건
 * ========================================================== */
export interface ServiceRow {
  marsServiceNo: string;
  name: string;
  shortName: string | null;
  price: number | null;
  category: string | null;
  qtyRule: string;
  rimMin: string | null;
  rimMax: string | null;
  forImported: boolean | null;
  isTireRelated: boolean;
  autoSuggest: boolean;
  isFavorite: boolean;
}

export function transformServices(dataDir: string): Transformed<ServiceRow> {
  const wb = openWorkbook(findFile(dataDir, "패스트핏 서비스"));
  const { rows: src } = readSheet(wb, "패스트핏 서비스 목록");
  const rows: ServiceRow[] = [];
  const issues: Issue[] = [];

  for (const r of src) {
    const no = toText(r["번호"]);
    const name = toText(r["이름"]);
    if (!no || !name) continue;

    const rule = SERVICE_RULES[no];
    const rawPrice = toInt(r["단가"]);
    // 단가 0 은 "0원 서비스"가 아니라 "건별로 정한다"는 뜻이다 → NULL
    const price = rawPrice === 0 ? null : rawPrice;

    if (price === null) {
      issues.push({
        kind: "service_price",
        refTable: "service_item",
        rawValue: name,
        suggestion: null,
        detail: `단가가 비어 있다 (${no}) — 견적에서 건별 입력`,
      });
    }

    rows.push({
      marsServiceNo: no,
      name,
      shortName: rule?.shortName ?? null,
      price,
      category: toText(r["품목 범주 코드"]),
      qtyRule: rule?.qtyRule ?? "per_job",
      rimMin: rule?.rimMin !== undefined ? String(rule.rimMin) : null,
      rimMax: rule?.rimMax !== undefined ? String(rule.rimMax) : null,
      forImported: rule?.forImported ?? null,
      isTireRelated: rule?.isTireRelated ?? false,
      autoSuggest: rule?.autoSuggest ?? false,
      isFavorite: rule?.isFavorite ?? false,
    });
  }
  return { rows, issues };
}

/* ============================================================
 * 6. customer — MARS 「연락처」 2,603건  ⭐ 「고객」이 아니다 (D-10)
 * ========================================================== */
export interface CustomerRow {
  marsContactNo: string;
  name: string;
  nameSearch: string;
  memo: string | null;
  phone: string | null;
  type: "개인" | "법인";
  isActive: boolean;
}

export function transformCustomers(dataDir: string): Transformed<CustomerRow> {
  const wb = openWorkbook(findFile(dataDir, "연락처 MARS"));
  const { rows: src } = readSheet(wb, "연락처");
  const rows: CustomerRow[] = [];
  const issues: Issue[] = [];

  const byPhone = new Map<string, string[]>();

  for (const r of src) {
    const no = toText(r["번호"]);
    const rawName = toText(r["이름"]);
    if (!no || !rawName) continue;

    const { base, memo } = splitNameMemo(rawName);
    const phone = normalizePhone(r["휴대폰 번호"]);
    // MARS 「유형」: 회사 = 법인, 사람 = 개인
    const type = /회사|company/i.test(String(r["유형"] ?? "")) ? "법인" : "개인";

    // 이름 자리에 차량번호가 들어간 건이 실측 3건 있었다
    if (/^\d{2,3}[가-힣]\d{4}$/.test(base.replace(/\s/g, ""))) {
      issues.push({
        kind: "name_is_plate",
        refTable: "customer",
        rawValue: rawName,
        suggestion: null,
        detail: `이름 자리에 차량번호가 들어 있다 (${no})`,
      });
    }

    if (!phone) {
      issues.push({
        kind: "no_phone",
        refTable: "customer",
        rawValue: rawName,
        suggestion: null,
        detail: `휴대폰 번호 없음 (${no}) — 문자 알림 대상에서 빠진다`,
      });
    } else {
      const list = byPhone.get(phone) ?? [];
      list.push(rawName);
      byPhone.set(phone, list);
    }

    rows.push({
      marsContactNo: no,
      name: rawName, // ⭐ 원문 보존. '고태환[한진택배]' 를 지우지 않는다
      nameSearch: normalizeName(rawName),
      memo,
      phone,
      type,
      isActive: !/yes|true|1|예/i.test(String(r["비활성"] ?? "")),
    });
  }

  // 같은 번호에 다른 이름 → 합치지 않고 연결만 한다 (family_group)
  for (const [phone, names] of byPhone) {
    const uniq = [...new Set(names)];
    if (uniq.length > 1) {
      issues.push({
        kind: "dup_customer",
        refTable: "customer",
        rawValue: phone,
        suggestion: uniq.join(" / "),
        detail: `같은 번호에 이름 ${uniq.length}개 — 합치지 말고 연결만`,
      });
    }
  }

  return { rows, issues };
}

/* ============================================================
 * 7. vehicle — 차량 2,574대
 * ========================================================== */
export interface VehicleRow {
  marsVehicleNo: string;
  marsContactNo: string | null; // 연결용 (DB 저장 시 customer.id 로 치환)
  plateNo: string;
  plateNoNorm: string;
  makerCode: string | null;
  model: string | null;
  year: number | null;
  mileage: number | null;
}

export function transformVehicles(dataDir: string): Transformed<VehicleRow> {
  const wb = openWorkbook(findFile(dataDir, "차량 목록 MARS"));
  const { rows: src } = readSheet(wb, "차량 목록");
  const rows: VehicleRow[] = [];
  const issues: Issue[] = [];

  for (const r of src) {
    const no = toText(r["차량 번호"]);
    const plateNo = toText(r["번호판 번호"]);
    if (!no || !plateNo) continue;

    const plateNoNorm = normalizePlate(plateNo);
    if (!/^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$/.test(plateNoNorm)) {
      issues.push({
        kind: "plate",
        refTable: "vehicle",
        rawValue: plateNo,
        suggestion: null,
        detail: `번호판 형식이 아니다 (${no})`,
      });
    }

    const rawMaker = r["차량 제조사"];
    const makerCode = resolveMaker(rawMaker);
    if (makerCode === null) {
      issues.push({
        kind: "maker",
        refTable: "vehicle",
        rawValue: String(rawMaker ?? ""),
        suggestion: null,
        detail: `모르는 제조사 표기 (${plateNo}) — seed-data.ts 에 추가 필요`,
      });
    }

    // 연식은 「등록 날짜」에서 뽑는다 (MARS에 연식 컬럼이 따로 없다)
    let year: number | null = null;
    const reg = r["등록 날짜"];
    if (reg instanceof Date) year = reg.getFullYear();
    else if (reg) {
      const m = /(19|20)\d{2}/.exec(String(reg));
      if (m) year = Number(m[0]);
    }

    rows.push({
      marsVehicleNo: no,
      marsContactNo: toText(r["연락처"]),
      plateNo,
      plateNoNorm,
      makerCode,
      model: toText(r["차량 모델"]),
      year,
      mileage: toInt(r["주행거리"]),
    });
  }
  return { rows, issues };
}

/* ============================================================
 * 8. stock_item (타이어) — 미쉐린 재고
 *    ⭐ 재고 코드가 MARS 품번과 100% 일치한다 (D-12). 손댈 것이 없다.
 * ========================================================== */
export interface TireStockRow {
  marsItemNo: string; // product 연결용
  dot: string | null;
  qty: number; // 항상 1 (1본 1행)
  rawLabel: string;
}

export function transformTireStock(dataDir: string): Transformed<TireStockRow> {
  const wb = openWorkbook(findFile(dataDir, "미쉐린 재고파악"));
  // ⭐ `틀` 시트는 폐기 확정 (사장님 확인 2026-08-01). `26.7.16재고UDT` 만 읽는다.
  const { rows: src } = readSheet(wb, "26.7.16재고UDT");
  const rows: TireStockRow[] = [];
  const issues: Issue[] = [];

  for (const r of src) {
    const code = toText(r["코드"]);
    const label = toText(r["타이어 규격 및 모델명"]) ?? "";
    if (!code) continue;

    const qty = toInt(r["수량"]) ?? 0;
    const dots = parseDotColumn(r["DOT(수량)"]);
    const dotTotal = dots.reduce((s, d) => s + d.qty, 0);

    if (dots.length > 0 && dotTotal !== qty) {
      issues.push({
        kind: "dot",
        refTable: "stock_item",
        rawValue: String(r["DOT(수량)"] ?? ""),
        suggestion: `수량 ${qty} / DOT 합 ${dotTotal}`,
        detail: `${code} ${label} — DOT 합과 수량이 다르다 (${dotTotal - qty > 0 ? "+" : ""}${dotTotal - qty}본)`,
      });
    }

    // DOT가 있으면 DOT별로, 없으면 수량만큼 DOT 없이 행을 만든다
    if (dots.length > 0) {
      for (const d of dots) {
        /**
         * ⚠️ 말이 안 되는 DOT는 **넣지 않고 비운다** (사장님 확인 2026-08-01).
         * 틀린 연식은 선입선출과 노후화 경고를 통째로 망가뜨린다.
         * 비워두면 나중에 실물을 보고 채울 수 있다 — 재고 화면에서 입력 가능.
         */
        const ok = isPlausibleDot(d.dot);
        if (!ok) {
          issues.push({
            kind: "dot",
            refTable: "stock_item",
            rawValue: d.dot,
            suggestion: null,
            detail: `${code} ${label} — DOT '${d.dot}'는 ${2000 + Number(d.dot.slice(2, 4))}년산이 된다. 오타로 보여 비워 둔다 (${d.qty}본)`,
          });
        }
        for (let i = 0; i < d.qty; i++) {
          rows.push({ marsItemNo: code, dot: ok ? d.dot : null, qty: 1, rawLabel: label });
        }
      }
    } else {
      for (let i = 0; i < qty; i++) {
        rows.push({ marsItemNo: code, dot: null, qty: 1, rawLabel: label });
      }
    }
  }
  return { rows, issues };
}

/* ============================================================
 * 5+9. product(부품) + stock_item(부품)
 *    ⚠️ 수량은 버린다. 실물과 맞지 않는다 (D-12 5번).
 *       품목 마스터만 만들고 verified_at = NULL → 화면에 「미확인」
 * ========================================================== */
export interface PartRow {
  partNo: string;
  fitment: string | null;
  position: string | null;
  category: string;
  rawName: string;
  sources: string[]; // 어느 파일에서 왔는지
}

/** 부품 파일별 설정. 좌우 2단 구성이라 컬럼이 두 벌씩 있다 */
const PART_FILES: {
  file: string;
  sheet?: string;
  category: string;
  blocks: { code: string; fitment: string; position?: string }[];
}[] = [
  {
    file: "에어필터",
    category: "에어필터",
    blocks: [
      { code: "코드", fitment: "적용 차종" },
      { code: "코드#2", fitment: "적용 차종3" },
    ],
  },
  {
    file: "오일필터",
    sheet: "오일필터",
    category: "오일필터",
    blocks: [
      { code: "코드", fitment: "적용 차종" },
      { code: "코드#2", fitment: "적용 차종#2" },
    ],
  },
  {
    file: "오일필터",
    sheet: "Sheet1",
    category: "오일필터",
    blocks: [{ code: "코드", fitment: "적용 차종" }],
  },
  {
    file: "브레이크패드",
    category: "브레이크패드",
    blocks: [
      { code: "품번", fitment: "해당 차종 및 세부 사양", position: "위치" },
      { code: "품번#2", fitment: "해당 차종 및 세부 사양#2", position: "위치#2" },
    ],
  },
  {
    file: "에어컨필터",
    category: "에어컨필터",
    blocks: [{ code: "코드", fitment: "적용 차종" }],
  },
];

export function transformParts(dataDir: string): Transformed<PartRow> {
  const byPartNo = new Map<string, PartRow>();
  const issues: Issue[] = [];

  for (const conf of PART_FILES) {
    let src: Row[];
    try {
      const wb = openWorkbook(findFile(dataDir, conf.file));
      const sheet = conf.sheet ?? wb.SheetNames[0];
      src = readSheet(wb, sheet).rows;
    } catch (e) {
      issues.push({
        kind: "part_file",
        refTable: "product",
        rawValue: conf.file,
        suggestion: null,
        detail: `부품 파일을 읽지 못했다: ${(e as Error).message}`,
      });
      continue;
    }

    const label = `${conf.file}${conf.sheet ? `/${conf.sheet}` : ""}`;
    for (const r of src) {
      for (const b of conf.blocks) {
        const partNo = toText(r[b.code]);
        if (!partNo) continue;
        // 헤더가 반복되는 줄이 섞여 있을 수 있다
        if (partNo === "코드" || partNo === "품번") continue;

        const existing = byPartNo.get(partNo);
        if (existing) {
          if (!existing.sources.includes(label)) existing.sources.push(label);
          continue; // ⭐ 합집합. 어느 시트가 맞는지 고를 필요가 없다 (수량을 안 쓰므로)
        }
        const fitment = toText(r[b.fitment]);
        byPartNo.set(partNo, {
          partNo,
          fitment,
          position: b.position ? toText(r[b.position]) : null,
          category: conf.category,
          rawName: `${conf.category} ${partNo}${fitment ? ` (${fitment})` : ""}`,
          sources: [label],
        });
      }
    }
  }

  return { rows: [...byPartNo.values()], issues };
}
