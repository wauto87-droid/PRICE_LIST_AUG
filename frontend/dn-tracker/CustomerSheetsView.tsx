'use client';
import React, { useMemo, useState } from 'react';
import { useTracker } from './TrackerContext';

export default function CustomerSheetsView() {
  const { items } = useTracker();
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);

  const customers = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(i => {
      counts[i.customer] = (counts[i.customer] || 0) + 1;
    });
    return Object.keys(counts).sort().map(c => ({ name: c, count: counts[c] }));
  }, [items]);

  const displayedItems = selectedCustomer ? items.filter(i => i.customer === selectedCustomer) : items;

  return (
    <div className="customer-sheets">
      <div className="sidebar">
        <h3>Directory</h3>
        <ul>
          <li className={selectedCustomer === null ? 'active' : ''} onClick={() => setSelectedCustomer(null)}>
            All Companies <span className="badge">{items.length}</span>
          </li>
          {customers.map(c => (
            <li key={c.name} className={selectedCustomer === c.name ? 'active' : ''} onClick={() => setSelectedCustomer(c.name)}>
              {c.name} <span className="badge">{c.count}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="sheet-content">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Doc No</th>
              <th>Customer Name</th>
              <th>Item Code</th>
              <th>Description</th>
              <th>Balance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {displayedItems.map(item => (
              <tr key={item.id}>
                <td>{item.date}</td>
                <td>{item.docNo}</td>
                <td>{item.customer}</td>
                <td>{item.itemCode}</td>
                <td>{item.itemName}</td>
                <td>{item.balance}</td>
                <td><span className={`status-badge ${item.status}`}>{item.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
