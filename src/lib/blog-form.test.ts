import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { EMPTY_FORM, formHasMaterial, formText, sanitizeForm, type BlogForm } from "./blog-form";
import { shotsFor, shotSummary, WORK_KINDS } from "./photo-checklist";

describe("작업 후기 폼 — 「사건」을 받는다", () => {
  it("아무것도 안 고르면 재료가 없다 — 원고를 만들지 않는다", () => {
    assert.equal(formHasMaterial(EMPTY_FORM), false);
  });

  it("칩 하나만 눌러도 재료가 된다 — 빈 칸을 강요하지 않는다", () => {
    assert.equal(formHasMaterial({ ...EMPTY_FORM, reasons: ["펑크"] }), true);
    assert.equal(formHasMaterial({ ...EMPTY_FORM, findings: ["안쪽 편마모"] }), true);
  });

  it("칩 없이 손으로 쓴 한 줄만 있어도 재료다", () => {
    assert.equal(formHasMaterial({ ...EMPTY_FORM, reasonNote: "아침에 시동이 안 걸린다고" }), true);
  });

  it("지시문 문장은 사장님이 고른 것만 담는다", () => {
    const f: BlogForm = {
      reasons: ["주행 중 소음·떨림"],
      reasonNote: "두 번째 방문",
      findings: ["안쪽 편마모"],
      whys: ["장거리·고속 주행이 많음"],
      treadMm: "3.5",
      torqueNm: "175",
    };
    const t = formText(f);
    assert.match(t, /왜 오셨나: 주행 중 소음·떨림 \/ 두 번째 방문/);
    assert.match(t, /점검해 보니: 안쪽 편마모/);
    assert.match(t, /이 제품을 권한 이유: 장거리·고속 주행이 많음/);
    assert.match(t, /남은 홈 3\.5mm/);
    assert.match(t, /휠 너트 조임 175Nm/);
  });

  it("숫자만 쳐도 단위가 붙고, 비었거나 0이면 아예 안 나온다", () => {
    assert.match(formText({ ...EMPTY_FORM, psi: "42" }), /공기압 42psi/);
    assert.equal(formText({ ...EMPTY_FORM, psi: "0" }), "");
    assert.equal(formText({ ...EMPTY_FORM, psi: "  " }), "");
  });

  it("목록에 없는 칩은 버린다 — 화면에서 온 값을 믿지 않는다", () => {
    const f = sanitizeForm({ reasons: ["펑크", "이상한값"], findings: "배열아님", whys: null });
    assert.deepEqual(f.reasons, ["펑크"]);
    assert.deepEqual(f.findings, []);
    assert.deepEqual(f.whys, []);
  });

  it("긴 글은 잘라 둔다 — 지시문이 통째로 부풀지 않게", () => {
    const f = sanitizeForm({ findingNote: "가".repeat(1000) });
    assert.equal(f.findingNote?.length, 400);
  });
});

describe("촬영 체크리스트 — 사장님 폴더에서 뽑은 목록", () => {
  it("작업 종류마다 목록이 나오고 12~16컷 사이다", () => {
    for (const k of WORK_KINDS) {
      const { total } = shotSummary(k);
      assert.ok(total >= 11 && total <= 17, `${k}: ${total}컷`);
    }
  });

  it("A(입고) → B(작업) → C(출고) 순서로 정렬된다", () => {
    const acts = shotsFor("타이어 교체").map((s) => s.act);
    assert.deepEqual([...acts].sort(), acts.slice().sort()); // 형식 확인
    const idx = { A: 0, B: 1, C: 2 } as const;
    for (let i = 1; i < acts.length; i++) assert.ok(idx[acts[i]] >= idx[acts[i - 1]]);
  });

  it("자리 이름은 A-00 꼴로 막마다 0부터 — 파일명·본문 자리표시자가 이걸로 맞물린다", () => {
    const s = shotsFor("배터리");
    assert.equal(s[0].slot, "A-00");
    assert.ok(s.some((x) => x.slot === "B-00"));
    assert.ok(s.some((x) => x.slot === "C-00"));
  });

  it("「이것만은 꼭」 컷이 작업마다 최소 4개 있다", () => {
    for (const k of WORK_KINDS) assert.ok(shotSummary(k).must >= 4, k);
  });

  it("전기차면 잭패드 컷이 붙는다 — EV 손님이 가장 신경 쓰는 부분", () => {
    const plain = shotsFor("타이어 교체", false);
    const ev = shotsFor("타이어 교체", true);
    assert.equal(ev.length, plain.length + 3);
    assert.ok(ev.some((s) => s.label.includes("잭패드")));
  });

  it("공통 3컷(정면·계기판·문제 부위)은 어느 작업에나 들어간다", () => {
    for (const k of WORK_KINDS) {
      const labels = shotsFor(k).map((s) => s.label);
      assert.ok(labels.some((l) => l.includes("차량 정면")), k);
      assert.ok(labels.some((l) => l.includes("계기판 주행거리") || l.includes("경고등 켜진")), k);
    }
  });
});
