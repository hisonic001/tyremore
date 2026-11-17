"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useConfirm } from "@/components/ui/confirm";
import { excludeStorage, releaseStorage, restoreStorage, updateStorage } from "@/lib/tire-storage";
import { sizeHints, type StorageDropInput, type StorageStatus } from "@/lib/tire-storage-pure";
import { DropFields } from "../drop-fields";

/** 보관 세트 상세의 단추들 — 위험한 것은 확인 시트(useConfirm) */
export function StorageActions({
  id,
  status,
  manualRelease,
  canEdit,
  drop: initial,
  lastFittedSize,
}: {
  id: number;
  status: StorageStatus;
  manualRelease: boolean;
  canEdit: boolean;
  drop: StorageDropInput;
  lastFittedSize?: string | null;
}) {
  const router = useRouter();
  const [ask, confirmNode] = useConfirm();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [drop, setDrop] = useState(initial);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setMsg({ tone: "success", text: done });
        setEditing(false);
        router.refresh();
      } else setMsg({ tone: "error", text: r.error });
    });

  return (
    <div className="mt-3">
      {confirmNode}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {status === "보관중" && !editing && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button
            pending={pending}
            onClick={async () => {
              if (!(await ask({ title: "손님이 찾아가셨나요?", body: "판매 없이 찾아간 것으로 표시합니다. 교체 작업을 했다면 판매 등록 화면에서 「오늘 찾아감」을 체크하는 편이 좋습니다.", confirmLabel: "찾아감" })))
                return;
              run(() => releaseStorage(id, "찾아감"), "찾아간 것으로 표시했습니다 — 스티커는 떼서 버려 주세요");
            }}
          >
            찾아감
          </Button>
          {canEdit && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              내용 고치기
            </Button>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              pending={pending}
              onClick={async () => {
                if (!(await ask({ title: "이 세트를 폐기했나요?", body: "손님 동의를 받고 버린 경우에만 누르세요. 기록은 남습니다.", confirmLabel: "폐기", tone: "danger" }))) return;
                run(() => releaseStorage(id, "폐기"), "폐기로 표시했습니다");
              }}
            >
              폐기
            </Button>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              pending={pending}
              onClick={async () => {
                if (!(await ask({ title: "잘못 등록한 건가요?", body: "이 등록을 지웁니다(기록은 「제외」로 남고 번호는 다시 쓰지 않습니다). 붙인 스티커는 떼 주세요.", confirmLabel: "등록 지우기", tone: "danger" })))
                  return;
                run(() => excludeStorage(id, "잘못 등록"), "등록을 지웠습니다");
              }}
            >
              잘못 등록 — 지우기
            </Button>
          )}
        </div>
      )}

      {editing && (
        <div className="mt-2 rounded-card border border-slate-200 bg-white p-3">
          <DropFields value={drop} onChange={setDrop} disabled={pending} sizeHints={sizeHints(initial.size, lastFittedSize)} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => (setEditing(false), setDrop(initial))}>
              취소
            </Button>
            <Button pending={pending} onClick={() => run(() => updateStorage(id, drop), "고쳤습니다 — 스티커 내용이 바뀌었다면 다시 뽑아 주세요")}>
              저장
            </Button>
          </div>
        </div>
      )}

      {(status === "찾아감" || status === "폐기") && manualRelease && canEdit && (
        <Button
          variant="ghost"
          className="mt-2"
          pending={pending}
          onClick={async () => {
            if (!(await ask({ title: "다시 보관 중으로 돌릴까요?", body: "잘못 누른 경우에만. 같은 번호 그대로 돌아옵니다.", confirmLabel: "되돌리기" }))) return;
            run(() => restoreStorage(id), "다시 보관 중으로 돌렸습니다");
          }}
        >
          잘못 눌렀어요 — 보관 중으로 되돌리기
        </Button>
      )}
    </div>
  );
}
