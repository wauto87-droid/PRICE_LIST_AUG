import React from 'react';
import { OrderItem } from './types';

interface PendingTableViewProps {
  activeItems: OrderItem[];
}

export default function PendingTableView({ activeItems }: PendingTableViewProps) {
  // Filter specifically for actionable pending items
  const pendingItems = activeItems.filter(i => i.balance >= 1 && i.status === 'pending');
  const totalBalance = pendingItems.reduce((acc, item) => acc + (item.balance || 0), 0);

  return (
    <div className="pending-table-view">
      <div className="pt-header">
        <h3>Actionable Pending Deliveries</h3>
      </div>
      
      <div className="pt-table-container">
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
            </tr>
          </thead>
          <tbody>
            {pendingItems.length === 0 ? (
              <tr><td colSpan={7} style={{textAlign: 'center', padding: 20}}>No pending items found matching your filters.</td></tr>
            ) : (
              pendingItems.map(item => (
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
          {pendingItems.length > 0 && (
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
