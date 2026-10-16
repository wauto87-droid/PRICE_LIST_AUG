"use client";
import type { ComponentProps, ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';

export default function SortableQuotationRow({ id, disabled, children, ...props }: Omit<ComponentProps<'tr'>, 'id' | 'children'> & {
  id: string;
  disabled: boolean;
  children: (handle: ReactNode) => ReactNode;
  handleLabel: string;
}) {
  const { handleLabel, ...rowProps } = props;
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging, isOver, activeIndex, overIndex } = useSortable({ id, disabled });
  return <tr {...rowProps} ref={setNodeRef} data-row-id={id}
    data-dragging={isDragging || undefined}
    data-drop-position={isOver && !isDragging ? (activeIndex < overIndex ? 'after' : 'before') : undefined}>
    {children(<button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners}
      className="quotation-drag-handle" disabled={disabled} aria-label={handleLabel} title={handleLabel}>⠿</button>)}
  </tr>;
}
