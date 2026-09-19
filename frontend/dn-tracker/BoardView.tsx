'use client';
import React, { useMemo } from 'react';
import { DndContext, DragEndEvent, closestCorners } from '@dnd-kit/core';
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
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="kanban-card">
      <div className="card-header">
        <strong>{item.docNo}</strong>
        <span className="date">{item.date}</span>
      </div>
      <div className="customer">{item.customer}</div>
      <div className="item-name">{item.itemName}</div>
      <div className="metrics">
        <span>Qty: {item.qty}</span>
        <span>Inv: {item.invoiced}</span>
        <span>Bal: {item.balance}</span>
      </div>
    </div>
  );
}

export default function BoardView() {
  const { items, setItems } = useTracker();

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const itemId = active.id as string;
    const overId = over.id as string;

    const item = items.find((i) => i.id === itemId);
    if (!item) return;

    // Check if dragging over a column or an item
    const targetStatus = columns.find(c => c.id === overId)?.id || items.find(i => i.id === overId)?.status;

    if (targetStatus && targetStatus !== item.status) {
      const updatedItem = transitionItemStatus(item, targetStatus);
      setItems((prev) => prev.map((i) => (i.id === itemId ? updatedItem : i)));
    }
  };

  const getItemsByStatus = (status: OrderItem['status']) => items.filter((i) => i.status === status);

  return (
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
              <SortableContext id={col.id} items={colItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                <div className="col-body">
                  {colItems.map((item) => (
                    <SortableItem key={item.id} item={item} />
                  ))}
                </div>
              </SortableContext>
            </div>
          );
        })}
      </div>
    </DndContext>
  );
}
