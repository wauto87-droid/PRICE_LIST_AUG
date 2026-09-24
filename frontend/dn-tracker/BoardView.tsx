"use client";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  rectIntersection,
} from "@dnd-kit/core";
import {
  stages,
  stageNames,
  billingNames,
  displayDate,
} from "../../shared/dn-tracker";
import type { Translate } from "../api";

function Card({ note, t, editable, open, move }: any) {
  const { setNodeRef, listeners, attributes, transform, isDragging } =
    useDraggable({
      id: note.id,
      disabled: !editable,
      data: { stage: note.stage },
    });
  return (
    <article
      ref={setNodeRef}
      className={"dn-card" + (isDragging ? " dragging" : "")}
      style={
        transform
          ? {
              transform: `translate(${transform.x}px,${transform.y}px)`,
              zIndex: 10,
            }
          : undefined
      }
    >
      <div className="dn-card-heading">
        <button className="dn-link" onClick={() => open(note.id)}>
          <strong>{note.doc_no}</strong>
        </button>
        {editable && (
          <button
            {...listeners}
            {...attributes}
            className="dn-drag"
            aria-label={
              t("Move delivery note", "نقل إذن التسليم") + " " + note.doc_no
            }
          >
            ⠿
          </button>
        )}
      </div>
      <button
        className="dn-link dn-customer-name"
        onClick={() => open(note.id)}
      >
        {note.customer}
      </button>
      <p className="muted">
        {displayDate(note.doc_date)} · {Math.max(0, note.age)}{" "}
        {t("days", "يوم")}
      </p>
      <span className={"dn-badge " + (note.outstanding ? "unbilled" : "")}>
        {t(
          ...(billingNames[note.billing] || [
            "Unknown billing status",
            "حالة فوترة غير معروفة",
          ]),
        )}
      </span>
      {note.needs_review && (
        <p className="error-text">
          {t("New figures need review", "الأرقام الجديدة تحتاج مراجعة")}
        </p>
      )}
      <p>
        {note.outstanding} {t("outstanding rows", "صفوف متبقية")}
      </p>
      <div className="dn-quantities">
        {Object.entries(note.quantities).map(([unit, qty]) => (
          <span key={unit}>
            {String(qty)} {unit}
          </span>
        ))}
      </div>
      <p className="muted">
        {note.assignee_name || t("Unassigned", "غير مسند")}
      </p>
      {note.latest_followup && (
        <p className="dn-last-comment">{note.latest_followup}</p>
      )}
      {editable && (
        <select
          aria-label={t("Move to", "نقل إلى") + " " + note.doc_no}
          value={note.stage}
          onChange={(e) => move(note, e.target.value)}
        >
          {stages.map((s) => (
            <option key={s} value={s}>
              {t(...stageNames[s])}
            </option>
          ))}
        </select>
      )}
    </article>
  );
}

function Column({ stage, children, count, t }: any) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <section
      ref={setNodeRef}
      data-dn-stage={stage}
      className={"dn-column " + (isOver ? "dn-over" : "")}
    >
      <h3>
        {t(...stageNames[stage])}
        <span>{count}</span>
      </h3>
      <div className="dn-column-body">{children}</div>
    </section>
  );
}

export default function ServerBoardView({
  rows,
  counts,
  t,
  editable,
  open,
  move,
}: {
  rows: any[];
  counts: any[];
  t: Translate;
  editable: boolean;
  open: (id: string) => void;
  move: (note: any, stage: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: (event, { currentCoordinates, context }) => {
        if (
          !["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(
            event.code,
          )
        )
          return;
        const all = Array.from(
          document.querySelectorAll<HTMLElement>("[data-dn-stage]"),
        );
        const current = all.findIndex(
          (e) =>
            e.dataset.dnStage ===
            String(context.over?.id || context.active?.data.current?.stage),
        );
        const rtl = document.documentElement.dir === "rtl";
        const step =
          (event.code === "ArrowRight"
            ? 1
            : event.code === "ArrowLeft"
              ? -1
              : event.code === "ArrowDown"
                ? 1
                : -1) *
          (rtl && ["ArrowRight", "ArrowLeft"].includes(event.code) ? -1 : 1);
        const target =
          all[
            Math.max(0, Math.min(3, current + step))
          ]?.getBoundingClientRect();
        return target
          ? { x: target.x + target.width / 2, y: target.y + 100 }
          : currentCoordinates;
      },
    }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      onDragEnd={({ active, over }) => {
        const note = rows.find((n) => n.id === active.id);
        if (note && over && note.stage !== over.id) move(note, String(over.id));
      }}
    >
      <div className="dn-board">
        {stages.map((stage) => (
          <Column
            key={stage}
            stage={stage}
            t={t}
            count={counts.find((c) => c.stage === stage)?.count || 0}
          >
            {rows
              .filter((n) => n.stage === stage)
              .map((note) => (
                <Card key={note.id} {...{ note, t, editable, open, move }} />
              ))}
            {!rows.some((n) => n.stage === stage) && (
              <p className="dn-empty">
                {t(
                  "No notes here. Drop a card to move it.",
                  "لا توجد أذونات. اسحب بطاقة إلى هنا لنقلها.",
                )}
              </p>
            )}
          </Column>
        ))}
      </div>
    </DndContext>
  );
}
