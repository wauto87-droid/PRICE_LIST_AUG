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
import GroupManagerView from './GroupManagerView';
import { OrderItem } from './types';
import './fulfillment.css';

import MultiVectorToolbar from './MultiVectorToolbar';

export default function FulfillmentEngine() {
  const { items, setItems, activeTab, setActiveTab, filters, groups } = useTracker();
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
          if (prev.length > 0) {
            const replace = window.confirm("You are uploading a new file. Do you want to REPLACE the existing data (Fresh Start)? \n\nClick OK to replace all data.\nClick Cancel to append to existing data.");
            if (replace) {
              return newItems;
            }
          }
          
          const existingKeys = new Set(prev.map(p => `${p.docNo}|${p.itemCode}|${p.date}`));
          const trulyNewItems = newItems.filter(n => !existingKeys.has(`${n.docNo}|${n.itemCode}|${n.date}`));
          return [...prev, ...trulyNewItems];
        });
      }
    } catch (err: any) {
      console.error("Upload error:", err);
      alert("Error reading file: " + (err.message || "Unknown error") + ". If this is an old .xls file, please resave it as .xlsx and try again.");
    } finally {
      if (e.target) {
        e.target.value = '';
      }
    }
  };

  const handleClear = () => {
    if(window.confirm('Are you sure you want to clear all data?')) setItems([]);
  };

  const activeItems = React.useMemo(() => {
    let result = items;

    // 1. Group filtering
    if (filters.activeGroupId) {
      const activeGroup = groups.find(g => g.id === filters.activeGroupId);
      if (activeGroup && activeGroup.companies.length > 0) {
        const groupSet = new Set(activeGroup.companies);
        if (filters.groupFilterMode === 'include') {
          result = result.filter(i => groupSet.has(i.customer));
        } else {
          result = result.filter(i => !groupSet.has(i.customer));
        }
      }
    }

    // 2. Balance Filter
    if (filters.balanceFilter === 'PENDING') {
      result = result.filter(i => i.balance >= 1);
    } else if (filters.balanceFilter === 'SETTLED') {
      result = result.filter(i => i.balance === 0);
    }

    // 3. Unit Filter
    if (filters.unitFilter) {
      result = result.filter(i => i.unit === filters.unitFilter);
    }

    // 4. Search Filter
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      result = result.filter(i => 
        String(i.docNo).toLowerCase().includes(query) ||
        (i.customer || '').toLowerCase().includes(query) ||
        (i.itemCode || '').toLowerCase().includes(query) ||
        (i.itemName || '').toLowerCase().includes(query)
      );
    }

    // 5. Sort
    if (filters.sortField) {
      result = [...result].sort((a, b) => {
        let valA: any = a[filters.sortField as keyof OrderItem];
        let valB: any = b[filters.sortField as keyof OrderItem];
        
        // Handle numeric parsing if docNo or balance
        if (filters.sortField === 'balance' || filters.sortField === 'docNo') {
          valA = parseFloat(valA) || 0;
          valB = parseFloat(valB) || 0;
        } else if (typeof valA === 'string' && typeof valB === 'string') {
          valA = valA.toLowerCase();
          valB = valB.toLowerCase();
        }

        if (valA < valB) return filters.sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return filters.sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [items, filters, groups]);

  return (
    <div className="fulfillment-engine">
      <input type="file" accept=".xlsx, .xls, .csv" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
      
      <MultiVectorToolbar 
        activeItems={activeItems}
        allRawItems={items}
        onUploadClick={() => fileInputRef.current?.click()}
        onClearClick={handleClear}
        onPrintPdfClick={() => {
          let printableItems = activeItems;
          let docTitle = filters.searchQuery || filters.activeGroupId || 'All Companies';
          
          if (activeTab === 'pending') {
            printableItems = activeItems.filter(i => i.balance >= 1 && i.status === 'pending');
            docTitle = 'Actionable Pending Deliveries';
          } else if (activeTab === 'customers' && filters.customerFilter) {
            printableItems = activeItems.filter(i => i.customer === filters.customerFilter);
            docTitle = filters.customerFilter;
          }

          const filteredOutCount = items.length - activeItems.length;
          printToPdf(printableItems, docTitle, filteredOutCount);
        }}
      />

      <div className="fe-tabs">
        <button className={`fe-tab ${activeTab === 'kanban' ? 'active' : ''}`} onClick={() => setActiveTab('kanban')}>Kanban Board</button>
        <button className={`fe-tab ${activeTab === 'customers' ? 'active' : ''}`} onClick={() => setActiveTab('customers')}>Customer Sheets</button>
        <button className={`fe-tab ${activeTab === 'pending' ? 'active' : ''}`} onClick={() => setActiveTab('pending')}>Pending Table</button>
        <button className={`fe-tab ${activeTab === 'presets' ? 'active' : ''}`} onClick={() => setActiveTab('presets')}><Settings size={14} style={{display:'inline', marginRight: 4, verticalAlign: 'middle'}}/> Groups</button>
      </div>

      <div className="fe-viewport">
        {activeTab === 'kanban' && <BoardView activeItems={activeItems} />}
        {activeTab === 'customers' && <CustomerSheetsView activeItems={activeItems} />}
        {activeTab === 'pending' && <PendingTableView activeItems={activeItems} />}
        {activeTab === 'presets' && <GroupManagerView />}
      </div>
    </div>
  );
}
