<<<<<<< Updated upstream
=======
<<<<<<< HEAD
'use client';
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, rectIntersection } from '@dnd-kit/core';
import { stages, stageNames, billingNames, displayDate } from '../../shared/dn-tracker';
import type { Translate } from '../api';
function Card({note,t,editable,open,move}:any) {
 const {setNodeRef,listeners,attributes,transform,isDragging}=useDraggable({id:note.id,disabled:!editable,data:{stage:note.stage}});
 return <article ref={setNodeRef} className={'dn-card'+(isDragging?' dragging':'')} style={transform?{transform:`translate(${transform.x}px,${transform.y}px)`,zIndex:10}:undefined}>
  <div className="dn-card-heading"><button className="dn-link" onClick={()=>open(note.id)}><strong>{note.doc_no}</strong></button>{editable&&<button {...listeners} {...attributes} className="dn-drag" aria-label={t('Move delivery note','نقل إذن التسليم')+' '+note.doc_no}>⠿</button>}</div>
  <button className="dn-link dn-customer-name" onClick={()=>open(note.id)}>{note.customer}</button>
  <p className="muted">{displayDate(note.doc_date)} · {Math.max(0,note.age)} {t('days','يوم')}</p>
  <span className={'dn-badge '+(note.outstanding?'unbilled':'')}>{t(...billingNames[note.billing])}</span>
  {note.needs_review&&<p className="error-text">{t('New figures need review','الأرقام الجديدة تحتاج مراجعة')}</p>}
  <p>{note.outstanding} {t('outstanding rows','صفوف متبقية')}</p>
  <div className="dn-quantities">{Object.entries(note.quantities).map(([unit,qty])=><span key={unit}>{String(qty)} {unit}</span>)}</div>
  <p className="muted">{note.assignee_name||t('Unassigned','غير مسند')}</p>
  {note.latest_followup&&<p className="dn-last-comment">{note.latest_followup}</p>}
  {editable&&<select aria-label={t('Move to','نقل إلى')+' '+note.doc_no} value={note.stage} onChange={e=>move(note,e.target.value)}>{stages.map(s=><option key={s} value={s}>{t(...stageNames[s])}</option>)}</select>}
 </article>;
}
function Column({stage,children,count,t}:any) {const {setNodeRef,isOver}=useDroppable({id:stage});return <section ref={setNodeRef} data-dn-stage={stage} className={'dn-column '+(isOver?'dn-over':'')}><h3>{t(...stageNames[stage])}<span>{count}</span></h3><div className="dn-column-body">{children}</div></section>;}
export default function BoardView({rows,counts,t,editable,open,move}: {rows:any[];counts:any[];t:Translate;editable:boolean;open:(id:string)=>void;move:(note:any,stage:string)=>void}) {
 const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:8}}),useSensor(KeyboardSensor,{coordinateGetter:(event,{currentCoordinates,context})=>{
  if(!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].includes(event.code))return;
  const all=Array.from(document.querySelectorAll<HTMLElement>('[data-dn-stage]'));
  const current=all.findIndex(e=>e.dataset.dnStage===String(context.over?.id||context.active?.data.current?.stage));
  const rtl=document.documentElement.dir==='rtl';const step=(event.code==='ArrowRight'?1:event.code==='ArrowLeft'?-1:event.code==='ArrowDown'?1:-1)*(rtl&&['ArrowRight','ArrowLeft'].includes(event.code)?-1:1);
  const target=all[Math.max(0,Math.min(3,current+step))]?.getBoundingClientRect();
  return target?{x:target.x+target.width/2,y:target.y+100}:currentCoordinates;
 }}));
 return <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragEnd={({active,over})=>{const note=rows.find(n=>n.id===active.id);if(note&&over&&note.stage!==over.id)move(note,String(over.id));}}><div className="dn-board">{stages.map(stage=><Column key={stage} stage={stage} t={t} count={counts.find(c=>c.stage===stage)?.count||0}>{rows.filter(n=>n.stage===stage).map(note=><Card key={note.id} {...{note,t,editable,open,move}}/>)}{!rows.some(n=>n.stage===stage)&&<p className="dn-empty">{t('No notes here. Drop a card to move it.','لا توجد أذونات. اسحب بطاقة إلى هنا لنقلها.')}</p>}</Column>)}</div></DndContext>;
=======
>>>>>>> Stashed changes
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
>>>>>>> fbaba6f03f306818557cdfba803d618e35f6d653
}
