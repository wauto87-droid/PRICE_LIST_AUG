'use client';
import React, { useState, useMemo } from 'react';
import { useTracker } from './TrackerContext';

type SortColumn = 'date' | 'docNo' | 'customer' | 'itemCode' | 'itemName' | 'qty' | 'balance';
type SortDirection = 'asc' | 'desc';

export default function PendingTableView() {
  const { items, presets, activePresetId } = useTracker();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('balance');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // First apply presets to get active items
  const activeItems = useMemo(() => {
    const activePreset = presets.find(p => p.id === activePresetId);
    if (!activePreset) return items;
    return items.filter(i => !activePreset.excludedCompanies.includes(i.customer));
  }, [items, presets, activePresetId]);

  // Then filter for pending
  const pendingItems = useMemo(() => activeItems.filter(i => i.balance >= 1 && i.status === 'pending'), [activeItems]);

  // Then apply search
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return pendingItems;
    const lowerQ = searchQuery.toLowerCase();
    return pendingItems.filter(i => 
      (i.customer || '').toLowerCase().includes(lowerQ) ||
      (i.docNo || '').toLowerCase().includes(lowerQ) ||
      (i.itemCode || '').toLowerCase().includes(lowerQ) ||
      (i.itemName || '').toLowerCase().includes(lowerQ) ||
      (i.customerCode || '').toLowerCase().includes(lowerQ)
    );
  }, [pendingItems, searchQuery]);

  // Then apply sort
  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      let valA: any = a[sortColumn];
      let valB: any = b[sortColumn];
      
      // Handle date formatting 'DD-MM-YYYY' to sort correctly
      if (sortColumn === 'date') {
        const parseDate = (dStr: string) => {
          if (!dStr) return 0;
          const parts = dStr.split('-');
          if (parts.length === 3) {
            // DD-MM-YYYY to YYYY-MM-DD
            return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
          }
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
    <div className="pending-table-view">
      <div className="pt-header">
        <h3>Actionable Pending Deliveries</h3>
        <input 
          type="text" 
          placeholder="Search by customer, doc no, item code..." 
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
            </tr>
          </thead>
          <tbody>
            {sortedItems.length === 0 ? (
              <tr><td colSpan={7} style={{textAlign: 'center', padding: 20}}>No pending items found matching your filters.</td></tr>
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
                </tr>
              ))
            )}
          </tbody>
          {sortedItems.length > 0 && (
            <tfoot>
              <tr style={{ background: '#f8fafc', fontWeight: 'bold' }}>
                <td colSpan={6} style={{ textAlign: 'right' }}>Total Actionable Balance:</td>
                <td>{totalBalance}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
