'use client';
import React, { useMemo, useState } from 'react';
import { useTracker } from './TrackerContext';

type SortColumn = 'date' | 'docNo' | 'customer' | 'itemCode' | 'itemName' | 'qty' | 'balance' | 'status';
type SortDirection = 'asc' | 'desc';

export default function CustomerSheetsView() {
  const { items, presets, activePresetId } = useTracker();
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Apply presets to get active items
  const activeItems = useMemo(() => {
    const activePreset = presets.find(p => p.id === activePresetId);
    if (!activePreset) return items;
    return items.filter(i => !activePreset.excludedCompanies.includes(i.customer));
  }, [items, presets, activePresetId]);

  const customers = useMemo(() => {
    const counts: Record<string, number> = {};
    activeItems.forEach(i => {
      counts[i.customer] = (counts[i.customer] || 0) + 1;
    });
    return Object.keys(counts).sort().map(c => ({ name: c, count: counts[c] }));
  }, [activeItems]);

  const displayedItems = selectedCustomer ? activeItems.filter(i => i.customer === selectedCustomer) : activeItems;

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return displayedItems;
    const lowerQ = searchQuery.toLowerCase();
    return displayedItems.filter(i => 
      String(i.customer || '').toLowerCase().includes(lowerQ) ||
      String(i.docNo || '').toLowerCase().includes(lowerQ) ||
      String(i.itemCode || '').toLowerCase().includes(lowerQ) ||
      String(i.itemName || '').toLowerCase().includes(lowerQ) ||
      String(i.customerCode || '').toLowerCase().includes(lowerQ)
    );
  }, [displayedItems, searchQuery]);

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      let valA: any = a[sortColumn];
      let valB: any = b[sortColumn];
      
      if (sortColumn === 'date') {
        const parseDate = (dStr: string) => {
          if (!dStr) return 0;
          const parts = dStr.split('-');
          if (parts.length === 3) return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
          return new Date(dStr).getTime() || 0;
        };
        valA = parseDate(a.date);
        valB = parseDate(b.date);
      }

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredItems, sortColumn, sortDirection]);

  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const renderSortIndicator = (col: SortColumn) => {
    if (sortColumn !== col) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
    return <span style={{ marginLeft: 4 }}>{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  const totalBalance = sortedItems.reduce((acc, item) => acc + (item.balance || 0), 0);

  return (
    <div className="customer-sheets">
      <div className="sidebar">
        <h3>Directory</h3>
        <ul>
          <li className={selectedCustomer === null ? 'active' : ''} onClick={() => setSelectedCustomer(null)}>
            All Companies <span className="badge">{activeItems.length}</span>
          </li>
          {customers.map(c => (
            <li key={c.name} className={selectedCustomer === c.name ? 'active' : ''} onClick={() => setSelectedCustomer(c.name)}>
              {c.name} <span className="badge">{c.count}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="sheet-content">
        <div className="pt-header" style={{ marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
            {selectedCustomer || 'All Companies'}
          </h3>
          <input 
            type="text" 
            placeholder="Search within view..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pt-search"
          />
        </div>
        <div className="pt-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('date')} className="sortable-th">Date {renderSortIndicator('date')}</th>
                <th onClick={() => handleSort('docNo')} className="sortable-th">Doc No {renderSortIndicator('docNo')}</th>
                <th onClick={() => handleSort('customer')} className="sortable-th">Customer Name {renderSortIndicator('customer')}</th>
                <th onClick={() => handleSort('itemCode')} className="sortable-th">Item Code {renderSortIndicator('itemCode')}</th>
                <th onClick={() => handleSort('itemName')} className="sortable-th">Description {renderSortIndicator('itemName')}</th>
                <th onClick={() => handleSort('qty')} className="sortable-th">Qty {renderSortIndicator('qty')}</th>
                <th onClick={() => handleSort('balance')} className="sortable-th">Balance {renderSortIndicator('balance')}</th>
                <th onClick={() => handleSort('status')} className="sortable-th">Status {renderSortIndicator('status')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.length === 0 ? (
                <tr><td colSpan={8} style={{textAlign: 'center', padding: 20}}>No items found.</td></tr>
              ) : (
                sortedItems.map(item => (
                  <tr key={item.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{item.date}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{item.docNo}</td>
                    <td>{item.customer}{item.customerCode ? ` (${item.customerCode})` : ''}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{item.itemCode}</td>
                    <td>{item.itemName}</td>
                    <td>{item.qty}</td>
                    <td><strong>{item.balance}</strong></td>
                    <td><span className={`status-badge ${item.status}`}>{item.status}</span></td>
                  </tr>
                ))
              )}
            </tbody>
            {sortedItems.length > 0 && (
              <tfoot>
                <tr style={{ background: '#f8fafc', fontWeight: 'bold' }}>
                  <td colSpan={6} style={{ textAlign: 'right' }}>Total Visible Balance:</td>
                  <td>{totalBalance}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
