import { OrderItem } from './types';

export const exportToExcelCsv = (items: OrderItem[], filename: string) => {
  const headers = [
    'Date', 'Document No', 'Customer Name', 'Item Code', 'Item Description',
    'Unit', 'Quantity', 'Invoiced', 'Invoice Returned', 'Delivery Returned',
    'Balance (Col K)', 'Workflow Status'
  ];

  const escapeCell = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;

  const rows = items.map((it) => [
    escapeCell(it.date),
    escapeCell(it.docNo),
    escapeCell(it.customer + (it.customerCode ? ` (${it.customerCode})` : '')),
    escapeCell(it.itemCode),
    escapeCell(it.itemName),
    escapeCell(it.unit),
    escapeCell(it.qty),
    escapeCell(it.invoiced),
    escapeCell(it.invoiceRet),
    escapeCell(it.deliveryRet),
    escapeCell(it.balance),
    escapeCell(it.status),
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

export const printToPdf = () => {
  window.print();
};
