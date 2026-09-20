'use client';
import React, { useMemo, useState } from 'react';
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

export default function BoardView() {
  const { items, setItems, presets, activePresetId } = useTracker();
  const [searchQuery, setSearchQuery] = useState('');

  // Apply presets to get active items
  const activeItems = useMemo(() => {
    const activePreset = presets.find(p => p.id === activePresetId);
    if (!activePreset) return items;
    return items.filter(i => !activePreset.excludedCompanies.includes(i.customer));
  }, [items, presets, activePresetId]);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return activeItems;
    const lowerQ = searchQuery.toLowerCase();
    return activeItems.filter(i => 
      String(i.customer || '').toLowerCase().includes(lowerQ) ||
      String(i.docNo || '').toLowerCase().includes(lowerQ) ||
      String(i.itemCode || '').toLowerCase().includes(lowerQ) ||
      String(i.itemName || '').toLowerCase().includes(lowerQ) ||
      String(i.customerCode || '').toLowerCase().includes(lowerQ)
    );
  }, [activeItems, searchQuery]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const itemId = active.id as string;
    const overId = over.id as string;

    const item = items.find((i) => i.id === itemId);
    if (!item) return;

    const targetStatus = columns.find(c => c.id === overId)?.id || items.find(i => i.id === overId)?.status;

    if (targetStatus && targetStatus !== item.status) {
      const updatedItem = transitionItemStatus(item, targetStatus as any);
      setItems((prev) => prev.map((i) => (i.id === itemId ? updatedItem : i)));
    }
  };

  const getItemsByStatus = (status: OrderItem['status']) => filteredItems.filter((i) => i.status === status);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="pt-header" style={{ marginBottom: '1rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Fulfillment Kanban</h3>
        <input 
          type="text" 
          placeholder="Search cards..." 
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="pt-search"
        />
      </div>
      
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
    </div>
  );
}
