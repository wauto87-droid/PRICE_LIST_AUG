'use client';
import React, { useMemo, useState } from 'react';
import { useTracker } from './TrackerContext';
import { OrderItem } from './types';

interface CustomerSheetsViewProps {
  activeItems: OrderItem[];
}

export default function CustomerSheetsView({ activeItems }: CustomerSheetsViewProps) {
  const { filters, updateFilter } = useTracker();
  const selectedCustomer = filters.customerFilter || null;
  const [sidebarSearch, setSidebarSearch] = useState('');

  // Extract unique customers from the globally filtered items
  const customers = useMemo(() => {
    const counts: Record<string, number> = {};
    activeItems.forEach(i => {
      counts[i.customer] = (counts[i.customer] || 0) + 1;
    });
    return Object.keys(counts).sort().map(c => ({ name: c, count: counts[c] }));
  }, [activeItems]);

  const filteredCustomers = useMemo(() => {
    if (!sidebarSearch.trim()) return customers;
    const q = sidebarSearch.toLowerCase();
    return customers.filter(c => c.name.toLowerCase().includes(q));
  }, [customers, sidebarSearch]);

  const displayedItems = selectedCustomer ? activeItems.filter(i => i.customer === selectedCustomer) : activeItems;

  const totalBalance = displayedItems.reduce((acc, item) => acc + (item.balance || 0), 0);

  return (
    <div className="customer-sheets">
      <div className="sidebar">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>Directory</h3>
        </div>
        <ul>
          <li className={selectedCustomer === null ? 'active' : ''} onClick={() => updateFilter('customerFilter', null)}>
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
          {filteredCustomers.map(c => (
            <li 
              key={c.name} 
              className={selectedCustomer === c.name ? 'active' : ''} 
              onClick={() => updateFilter('customerFilter', c.name)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
              </div>
              <span className="badge">{c.count}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="sheet-content">
        <div className="pt-header" style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
            {selectedCustomer || 'All Companies'}
          </h3>
        </div>
        <div className="pt-table-container" style={{ flex: 1, overflow: 'auto', border: 'none', borderRadius: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Doc No</th>
                <th>Customer Name</th>
                <th>Item Code</th>
                <th>Description</th>
                <th>Qty</th>
                <th>Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {displayedItems.length === 0 ? (
                <tr><td colSpan={8} style={{textAlign: 'center', padding: 20}}>No items found.</td></tr>
              ) : (
                displayedItems.map(item => (
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
            {displayedItems.length > 0 && (
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
