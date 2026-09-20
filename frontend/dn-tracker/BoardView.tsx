'use client';
import React from 'react';
import { DndContext, DragEndEvent, closestCorners, useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
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

function SortableItem({ item }: { item: OrderItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { 
    transform: CSS.Transform.toString(transform), 
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 999 : 1
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="kanban-card">
      <div className="card-header">
        <strong>{item.docNo}</strong>
        <span className="date">{item.date}</span>
      </div>
      <div className="customer">{item.customer}{item.customerCode ? ` (${item.customerCode})` : ''}</div>
      <div className="item-name">{item.itemName}</div>
      <div className="metrics">
        <span>Qty: {item.qty}</span>
        <span>Inv: {item.invoiced}</span>
        <span>Bal: {item.balance}</span>
      </div>
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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const itemId = active.id as string;
    const overId = over.id as string;

    const item = items.find((i) => i.id === itemId);
    if (!item) return;

    // The overId is either the column ID or another item's ID
    const targetStatus = columns.find(c => c.id === overId)?.id || items.find(i => i.id === overId)?.status;

    if (targetStatus && targetStatus !== item.status) {
      const updatedItem = transitionItemStatus(item, targetStatus as any);
      setItems((prev) => prev.map((i) => (i.id === itemId ? updatedItem : i)));
    }
  };

  const getItemsByStatus = (status: OrderItem['status']) => activeItems.filter((i) => i.status === status);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <DndContext collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
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
      </DndContext>
    </div>
  );
}
