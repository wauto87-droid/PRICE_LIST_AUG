'use client';
import React, { useRef } from 'react';
import { Upload, Download, Printer, Settings, Trash2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { detectColumnIndices, deriveItemStatus } from './engineLogic';
import { exportToExcelCsv, printToPdf } from './exportLogic';
import { useTracker } from './TrackerContext';
import BoardView from './BoardView';
import CustomerSheetsView from './CustomerSheetsView';
import PendingTableView from './PendingTableView';
import PresetManagerView from './PresetManagerView';
import { OrderItem } from './types';
import './fulfillment.css';

export default function FulfillmentEngine() {
  const { items, setItems, activeTab, setActiveTab } = useTracker();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      if (!worksheet) {
        alert("Could not find any worksheets in the file.");
        return;
      }

      const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });

      let headers: string[] = [];
      let headerRowIndex = 0;

      for (let i = 0; i < rows.length; i++) {
        const rowValues = rows[i];
        if (headers.length === 0 && rowValues && rowValues.length > 0) {
          // More robust header detection: look for doc, document, or date or item
          const hasTargetHeader = rowValues.some(v => 
            typeof v === 'string' && (v.toLowerCase().includes('doc') || v.toLowerCase().includes('item') || v.toLowerCase().includes('date') || v.toLowerCase().includes('qty'))
          );
          if (hasTargetHeader) {
            headers = rowValues.map(v => v?.toString() || '');
            headerRowIndex = i;
            break;
          }
        }
      }

      if (headers.length === 0) {
        alert("Could not detect header row. Make sure the first row has column names like 'Doc No', 'Item', 'Qty', etc.");
        return;
      }

      const indices = detectColumnIndices(headers);
      const newItems: OrderItem[] = [];

      for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const vals = rows[i];
        
        const val = (idx: number) => {
          if (idx < 0) return '';
          const v = vals[idx];
          return typeof v === 'object' && v !== null && 'text' in v ? v.text : v?.toString() || '';
        };

        const docNo = val(indices.docNo);
        // Fallback: if docNo is empty, maybe we should just skip, but if qty exists we might want it?
        // Let's require docNo or itemCode
        const itemCode = val(indices.itemCode);
        if (!docNo && !itemCode) continue; // skip empty rows

        let formattedDate = val(indices.date);
        const rawDateStr = formattedDate;
        if (!isNaN(Number(rawDateStr)) && Number(rawDateStr) > 20000 && Number(rawDateStr) < 60000) {
          // Convert Excel serial date
          const dateObj = new Date(Math.round((Number(rawDateStr) - 25569) * 86400 * 1000));
          const yyyy = dateObj.getFullYear();
          const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
          const dd = String(dateObj.getDate()).padStart(2, '0');
          formattedDate = `${dd}-${mm}-${yyyy}`;
        }

        const item: Partial<OrderItem> = {
          id: `item-${Date.now()}-${i}`,
          index: i,
          date: formattedDate,
          docNo: docNo || `UNKNOWN-${i}`,
          customer: val(indices.customer).trim(),
          customerCode: val(indices.customerCode).trim(),
          itemCode: itemCode,
          itemName: val(indices.itemName),
          unit: val(indices.unit),
          qty: parseFloat(val(indices.qty)) || 0,
          invoiced: parseFloat(val(indices.invoiced)) || 0,
          invoiceRet: parseFloat(val(indices.invoiceRet)) || 0,
          deliveryRet: parseFloat(val(indices.deliveryRet)) || 0,
          balance: parseFloat(val(indices.balance)) || 0,
          rawRow: vals
        };

        item.status = deriveItemStatus(item);
        newItems.push(item as OrderItem);
      }

      if (newItems.length === 0) {
        alert("File was parsed, but no valid data rows were found.");
      } else {
        setItems(prev => {
          const existingKeys = new Set(prev.map(p => `${p.docNo}|${p.itemCode}|${p.date}`));
          const trulyNewItems = newItems.filter(n => !existingKeys.has(`${n.docNo}|${n.itemCode}|${n.date}`));
          return [...prev, ...trulyNewItems];
        });
      }
    } catch (err: any) {
      console.error("Upload error:", err);
      alert("Error reading file: " + (err.message || "Unknown error") + ". If this is an old .xls file, please resave it as .xlsx and try again.");
    } finally {
      // Clear the input value so the same file can be uploaded again if needed
      if (e.target) {
        e.target.value = '';
      }
    }
  };

  const activeItems = React.useMemo(() => {
    const { presets, activePresetId } = useTracker();
    const activePreset = presets.find(p => p.id === activePresetId);
    if (!activePreset) return items;
    return items.filter(i => !activePreset.excludedCompanies.includes(i.customer));
  }, [items]);

  return (
    <div className="fulfillment-engine">
      <div className="fe-topbar">
        <div className="fe-brand">
          <h2>Find Non-Invoiced Companies from DN</h2>
        </div>
        <div className="fe-actions">
          <input type="file" accept=".xlsx, .xls, .csv" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
          <button onClick={() => fileInputRef.current?.click()} className="btn btn-primary">
            <Upload size={16} /> Upload Data
          </button>
          <button onClick={() => { if(window.confirm('Are you sure you want to clear all data?')) setItems([]); }} className="btn btn-secondary" style={{ color: 'red' }}>
            <Trash2 size={16} /> Clear Data
          </button>
          <button onClick={() => exportToExcelCsv(activeItems, 'Export')} className="btn btn-secondary">
            <Download size={16} /> Export CSV
          </button>
          <button onClick={printToPdf} className="btn btn-secondary">
            <Printer size={16} /> Print PDF
          </button>
        </div>
      </div>

      <div className="fe-tabs">
        <button className={`fe-tab ${activeTab === 'kanban' ? 'active' : ''}`} onClick={() => setActiveTab('kanban')}>Kanban Board</button>
        <button className={`fe-tab ${activeTab === 'customers' ? 'active' : ''}`} onClick={() => setActiveTab('customers')}>Customer Sheets</button>
        <button className={`fe-tab ${activeTab === 'pending' ? 'active' : ''}`} onClick={() => setActiveTab('pending')}>Pending Table</button>
        <button className={`fe-tab ${activeTab === 'presets' ? 'active' : ''}`} onClick={() => setActiveTab('presets')}><Settings size={14} style={{display:'inline', marginRight: 4, verticalAlign: 'middle'}}/> Presets</button>
      </div>

      <div className="fe-viewport">
        {activeTab === 'kanban' && <BoardView />}
        {activeTab === 'customers' && <CustomerSheetsView />}
        {activeTab === 'pending' && <PendingTableView />}
        {activeTab === 'presets' && <PresetManagerView />}
      </div>
    </div>
  );
}
