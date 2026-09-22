'use client';
import React, { useState } from 'react';
import { DndContext, DragEndEvent, DragStartEvent, closestCorners, useDroppable, DragOverlay } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTracker } from './TrackerContext';
import { OrderItem } from './types';
import { transitionItemStatus } from './engineLogic';

const columns = [
  { id: 'pending', title: 'Pending Balance', color: 'amber' },
  { id: 'partial', title: 'Partially Fulfilled', color: 'sky' },
  { id: 'returned', title: 'Returned / RMA', color: 'rose' },
  { id: 'completed', title: 'Fully Invoiced', color: 'emerald' },
] as const;

function KanbanCard({ item, isOverlay = false }: { item: OrderItem, isOverlay?: boolean }) {
  return (
    <div className={`kanban-card group ${isOverlay ? 'shadow-2xl ring-2 ring-blue-500 cursor-grabbing' : 'cursor-grab'}`}>
      <div className="card-header">
        <strong>{item.docNo}</strong>
        <span className="date">{item.date}</span>
      </div>
      <div className="customer flex justify-between items-center pr-1">
        <span className="truncate" title={item.customer}>{item.customer}{item.customerCode ? ` (${item.customerCode})` : ''}</span>
      </div>
      <div className="item-name">{item.itemName}</div>
      <div className="metrics">
        <span>Qty: {item.qty}</span>
        <span>Inv: {item.invoiced}</span>
        <span>Bal: {item.balance}</span>
      </div>
    </div>
  );
}

function SortableItem({ item }: { item: OrderItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style: React.CSSProperties = { 
    transform: CSS.Transform.toString(transform), 
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 999 : 1,
    touchAction: 'none'
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <KanbanCard item={item} />
    </div>
  );
}

function DroppableColumn({ id, items, children }: { id: string, items: OrderItem[], children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <SortableContext id={id} items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
      <div ref={setNodeRef} className="col-body" style={{ minHeight: '200px' }}>
        {children}
      </div>
    </SortableContext>
  );
}

interface BoardViewProps {
  activeItems: OrderItem[];
}

export default function BoardView({ activeItems }: BoardViewProps) {
  const { items, setItems } = useTracker();
  const [activeId, setActiveId] = useState<string | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const itemId = active.id as string;
    const overId = over.id as string;

    if (itemId === overId) return;

    const item = items.find((i) => i.id === itemId);
    if (!item) return;

    const isOverColumn = columns.some(c => c.id === overId);
    const targetStatus = isOverColumn ? overId : items.find(i => i.id === overId)?.status;

    if (targetStatus && targetStatus !== item.status) {
      const updatedItem = transitionItemStatus(item, targetStatus as any);
      setItems((prev) => {
        const newItems = prev.map((i) => (i.id === itemId ? updatedItem : i));
        if (!isOverColumn) {
          const oldIndex = newItems.findIndex(i => i.id === itemId);
          const newIndex = newItems.findIndex(i => i.id === overId);
          if (oldIndex !== -1 && newIndex !== -1) {
            return arrayMove(newItems, oldIndex, newIndex);
          }
        }
        return newItems;
      });
    } else if (targetStatus && targetStatus === item.status && !isOverColumn) {
      setItems((prev) => {
        const oldIndex = prev.findIndex(i => i.id === itemId);
        const newIndex = prev.findIndex(i => i.id === overId);
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          return arrayMove(prev, oldIndex, newIndex);
        }
        return prev;
      });
    }
  };

  const getItemsByStatus = (status: OrderItem['status']) => activeItems.filter((i) => i.status === status);
  const activeDragItem = activeId ? items.find(i => i.id === activeId) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <DndContext collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="kanban-board">
          {columns.map((col) => {
            const colItems = getItemsByStatus(col.id);
            return (
              <div key={col.id} className={`kanban-col ${col.color}`}>
                <div className="col-header">
                  <h3>{col.title}</h3>
                  <span className="badge">{colItems.length}</span>
                </div>
                <DroppableColumn id={col.id} items={colItems}>
                  {colItems.map((item) => (
                    <SortableItem key={item.id} item={item} />
                  ))}
                </DroppableColumn>
              </div>
            );
          })}
        </div>
        <DragOverlay>
          {activeDragItem ? <KanbanCard item={activeDragItem} isOverlay /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
