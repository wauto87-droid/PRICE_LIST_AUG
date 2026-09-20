'use client';
import React from 'react';
import { useTracker } from './TrackerContext';

export default function PendingTableView() {
  const { items } = useTracker();
  const pendingItems = items.filter(i => i.balance >= 1 && i.status === 'pending');

  return (
    <div className="pending-table-view">
      <h3>Actionable Pending Deliveries</h3>
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
            <tr><td colSpan={7} style={{textAlign: 'center', padding: 20}}>No pending items.</td></tr>
          ) : (
            pendingItems.map(item => (
              <tr key={item.id}>
                <td>{item.date}</td>
                <td>{item.docNo}</td>
                <td>{item.customer}{item.customerCode ? ` (${item.customerCode})` : ''}</td>
                <td>{item.itemCode}</td>
                <td>{item.itemName}</td>
                <td>{item.qty}</td>
                <td><strong>{item.balance}</strong></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
