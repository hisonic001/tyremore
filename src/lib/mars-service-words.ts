/**
 * ⭐ 공임 이름 → MARS 차량 점검표 「교체」 체크 — 낱말 규칙 정본 (2026-08-31)
 *
 *   원래 scripts/mars-fill.ts 안에만 있던 규칙을 그대로 옮겨 왔다 (동작 변화 0).
 *   공임·정비 목록을 화면에서 고칠 수 있게 되면서(사장님 요청 2026-08-31),
 *   이름에서 낱말이 빠지면 점검표 체크가 **조용히** 안 켜지는 사고가 가능해졌다 —
 *   관리 화면이 이 규칙으로 「이 이름이면 점검표에 무엇이 표시되는지」를 미리 보여 준다.
 *
 *   규칙의 유래 (사장님 지시 2026-08-05):
 *   "얼라이먼트 조정, 엔진오일 교환, 브레이크 패드 교환, 배터리 교환 시에도
 *    여전히 100%에 체크하고 완료함. 교체 혹은 교환시(단순 점검시에는 아님)에는
 *    100%가 아닌 교체 체크란에 체크하도록."
 *
 * 🔴 「점검」이 들어간 서비스(배터리 점검 등)는 교체가 아니다 — 체크 안 함.
 * ⚠️ 패드는 이름에 앞/뒤가 없으면 **전륜**으로 본다 (가장 흔한 경우) —
 *    뒤 패드였으면 MARS 점검표에서 고쳐야 한다. 후륜·리어·뒤·드럼·라이닝·슈면 후륜.
 *
 * 🔴 "use server" 아님 — 순수 계산. scripts/mars-fill.ts 와 관리 화면이 같이 쓴다.
 *    여기 말고 다른 곳에 이 regex 사본을 만들지 않는다 (pos-vocab 과 같은 이치).
 */

export type ReplacedItems = {
  padFront: boolean;
  padRear: boolean;
  alignment: boolean;
  battery: boolean;
  engineOil: boolean;
};

export function replacedFromServices(names: (string | null)[]): ReplacedItems {
  const done: ReplacedItems = { padFront: false, padRear: false, alignment: false, battery: false, engineOil: false };
  for (const raw of names) {
    const n = (raw ?? "").replace(/\s+/g, "");
    if (!n || /점검/.test(n)) continue;
    if (/엔진오일/.test(n)) done.engineOil = true;
    if (/배터리/.test(n)) done.battery = true;
    if (/얼라이|얼라인/.test(n)) done.alignment = true;
    if (/패드|라이닝|브레이크슈/.test(n)) {
      // 드럼·라이닝·슈는 후륜이다 — 점검표의 후륜 줄 이름이 「패드/슈」인 것과 같은 이치
      if (/후륜|리어|뒤|드럼|라이닝|슈/.test(n)) done.padRear = true;
      else done.padFront = true;
    }
  }
  return done;
}

/** 관리 화면 미리보기용 — 이 이름 하나가 점검표에서 켜는 항목들 (없으면 빈 배열) */
export function replacedLabels(name: string): string[] {
  const r = replacedFromServices([name]);
  const out: string[] = [];
  if (r.engineOil) out.push("엔진오일");
  if (r.battery) out.push("배터리");
  if (r.alignment) out.push("얼라인먼트");
  if (r.padFront) out.push("앞 브레이크 패드");
  if (r.padRear) out.push("뒤 브레이크 패드/슈");
  return out;
}
