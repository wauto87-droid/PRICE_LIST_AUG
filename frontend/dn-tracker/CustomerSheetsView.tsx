'use client';
import React, { useMemo, useState } from 'react';
import { useTracker } from './TrackerContext';

type SortColumn = 'date' | 'docNo' | 'customer' | 'itemCode' | 'itemName' | 'qty' | 'balance' | 'status';
type SortDirection = 'asc' | 'desc';

export default function CustomerSheetsView() {
  const { items, presets, setPresets, activePresetId } = useTracker();
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [sidebarSearch, setSidebarSearch] = useState('');
  
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const activePreset = presets.find(p => p.id === activePresetId);

  // Apply presets to get active items
  const activeItems = useMemo(() => {
    if (!activePreset) return items;
    return items.filter(i => !activePreset.excludedCompanies.includes(i.customer));
  }, [items, activePreset]);

  // Use ALL items for the sidebar so they can be toggled back on
  const customers = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(i => {
      counts[i.customer] = (counts[i.customer] || 0) + 1;
    });
    return Object.keys(counts).sort().map(c => ({ name: c, count: counts[c] }));
  }, [items]);

  const filteredCustomers = useMemo(() => {
    if (!sidebarSearch.trim()) return customers;
    const q = sidebarSearch.toLowerCase();
    return customers.filter(c => c.name.toLowerCase().includes(q));
  }, [customers, sidebarSearch]);

  const toggleCompany = (company: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activePresetId) {
      alert("Please select a Preset first in the Presets tab to hide/show companies.");
      return;
    }
    setPresets(prev => prev.map(p => {
      if (p.id !== activePresetId) return p;
      const excluded = p.excludedCompanies.includes(company)
        ? p.excludedCompanies.filter(c => c !== company)
        : [...p.excludedCompanies, company];
      return { ...p, excludedCompanies: excluded };
    }));
  };

  const hideAll = () => {
    if (!activePresetId) return;
    setPresets(prev => prev.map(p => {
      if (p.id !== activePresetId) return p;
      return { ...p, excludedCompanies: customers.map(c => c.name) };
    }));
  };

  const showAll = () => {
    if (!activePresetId) return;
    setPresets(prev => prev.map(p => {
      if (p.id !== activePresetId) return p;
      return { ...p, excludedCompanies: [] };
    }));
  };

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>Directory</h3>
          {activePresetId && (
            <div style={{ display: 'flex', gap: '4px' }}>
              <button onClick={showAll} title="Show All" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>👁️</button>
              <button onClick={hideAll} title="Hide All" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', opacity: 0.5 }}>👁️‍🗨️</button>
            </div>
          )}
        </div>
        <ul>
          <li className={selectedCustomer === null ? 'active' : ''} onClick={() => setSelectedCustomer(null)}>
            All Companies <span className="badge">{activeItems.length}</span>
          </li>
          <div style={{ padding: '0.5rem 1rem' }}>
            <input 
              type="text" 
              placeholder="Search companies..." 
              value={sidebarSearch}
              onChange={e => setSidebarSearch(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', border: '1px solid #e2e8f0', borderRadius: '0.25rem', fontSize: '0.8rem' }}
            />
          </div>
          {filteredCustomers.map(c => {
            const isExcluded = activePreset?.excludedCompanies.includes(c.name);
            return (
              <li 
                key={c.name} 
                className={selectedCustomer === c.name ? 'active' : ''} 
                onClick={() => setSelectedCustomer(c.name)}
                style={{ opacity: isExcluded ? 0.5 : 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                  {activePresetId && (
                    <button 
                      onClick={(e) => toggleCompany(c.name, e)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      title={isExcluded ? "Show company" : "Hide company"}
                    >
                      {isExcluded ? '👁️‍🗨️' : '👁️'}
                    </button>
                  )}
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                </div>
                <span className="badge">{c.count}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="sheet-content">
        <div className="pt-header" style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
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
        <div className="pt-table-container" style={{ flex: 1, overflow: 'auto', border: 'none', borderRadius: 0 }}>
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
