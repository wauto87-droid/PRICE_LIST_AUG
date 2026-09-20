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

const generateHtmlReport = (items: OrderItem[], scope: string, excludedCount: number): string => {
  const totalQty = items.reduce((sum, item) => sum + (item.qty || 0), 0);
  const totalInvoiced = items.reduce((sum, item) => sum + (item.invoiced || 0), 0);
  const totalBalance = items.reduce((sum, item) => sum + (item.balance || 0), 0);
  const dateStr = new Date().toISOString().split('T')[0];

  const rowsHtml = items.map(item => {
    const returnTotal = (item.invoiceRet || 0) + (item.deliveryRet || 0);
    const retColor = returnTotal > 0 ? 'color: red;' : '';
    const statusPill = `<span style="padding: 2px 6px; border-radius: 12px; font-size: 8pt; background: #e2e8f0; font-weight: bold;">${item.status.toUpperCase()}</span>`;
    
    return `
      <tr>
        <td style="width: 75px; text-align: center; font-family: monospace; white-space: nowrap;">${item.date}</td>
        <td style="width: 65px; text-align: center; font-family: monospace; font-weight: bold; white-space: nowrap;">${item.docNo}</td>
        <td style="width: 150px; font-weight: bold;"><div dir="auto">${item.customer}</div></td>
        <td>
          <div dir="auto">${item.itemName || '-'}</div>
          <div style="font-family: monospace; color: #64748b; font-size: 8pt;">${item.itemCode || '-'}</div>
        </td>
        <td style="width: 40px; text-align: right; font-family: monospace; font-weight: bold;">${item.qty}</td>
        <td style="width: 35px; text-align: center;">${item.unit}</td>
        <td style="width: 45px; text-align: right; font-family: monospace;">${item.invoiced}</td>
        <td style="width: 40px; text-align: right; font-family: monospace; ${retColor}">${returnTotal}</td>
        <td style="width: 50px; text-align: right; font-family: monospace; font-weight: bold; background-color: #fef3c7 !important; color: #92400e !important;">${item.balance}</td>
        <td style="width: 65px; text-align: center;">${statusPill}</td>
      </tr>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>Report</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 12mm 10mm 14mm 10mm;
        }
        @media print {
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body {
            margin: 0 !important;
            padding: 0 !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 9pt;
            line-height: 1.3;
            color: #0f172a;
            background: #ffffff !important;
          }
          .no-print {
            display: none !important;
          }
          table {
            width: 100% !important;
            border-collapse: collapse !important;
            page-break-inside: auto;
          }
          thead {
            display: table-header-group !important;
          }
          tr {
            page-break-inside: avoid !important;
            page-break-after: auto;
          }
          th, td {
            padding: 5px 6px !important;
            border: 0.5pt solid #cbd5e1 !important;
          }
          th {
            background-color: #f1f5f9 !important;
            text-align: left;
            font-weight: bold;
          }
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          font-size: 9pt;
          color: #0f172a;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        th, td {
          padding: 5px 6px;
          border: 0.5pt solid #cbd5e1;
        }
        th {
          background-color: #f1f5f9;
          text-align: left;
          font-weight: bold;
        }
        .header-block {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 12px;
          border-bottom: 2px solid #0f172a;
          padding-bottom: 8px;
        }
        .kpi-strip {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          margin-bottom: 16px;
        }
        .kpi-card {
          border: 1px solid #cbd5e1;
          padding: 8px;
          border-radius: 4px;
        }
        .kpi-value {
          font-size: 14pt;
          font-weight: bold;
        }
        .kpi-label {
          font-size: 8pt;
          color: #64748b;
          text-transform: uppercase;
        }
      </style>
    </head>
    <body>
      <div class="header-block">
        <div>
          <h2 style="margin: 0; font-size: 14pt;">ORDER FULFILLMENT & OUTSTANDING BALANCE REPORT</h2>
          <div style="color: #64748b; margin-top: 4px;">Scope: ${scope}</div>
        </div>
        <div style="text-align: right; font-size: 8pt; color: #475569;">
          <div>Generated: ${dateStr}</div>
          <div>Active Filters: Excluded: ${excludedCount} companies</div>
          <div style="font-weight: bold; margin-top: 4px;">Total Rows: ${items.length}</div>
        </div>
      </div>

      <div class="kpi-strip">
        <div class="kpi-card">
          <div class="kpi-label">Total Line Items</div>
          <div class="kpi-value">${items.length}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Total Quantity Ordered</div>
          <div class="kpi-value">${totalQty}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Total Invoiced</div>
          <div class="kpi-value">${totalInvoiced}</div>
        </div>
        <div class="kpi-card" style="background-color: #fef3c7 !important; border-color: #fcd34d !important;">
          <div class="kpi-label" style="color: #92400e;">Open Balance Sum</div>
          <div class="kpi-value" style="color: #b45309;">${totalBalance}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 75px; text-align: center; white-space: nowrap;">Date</th>
            <th style="width: 65px; text-align: center; white-space: nowrap;">Doc #</th>
            <th style="width: 150px;">Customer Name</th>
            <th>Item Description & Code</th>
            <th style="width: 40px; text-align: right;">Qty</th>
            <th style="width: 35px; text-align: center;">Unit</th>
            <th style="width: 45px; text-align: right;">Invoiced</th>
            <th style="width: 40px; text-align: right;">Ret</th>
            <th style="width: 50px; text-align: right;">Balance</th>
            <th style="width: 65px; text-align: center;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </body>
    </html>
  `;
};

export const printToPdf = (items: OrderItem[], scope: string, excludedCount: number) => {
  const html = generateHtmlReport(items, scope, excludedCount);
  
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  
  document.body.appendChild(iframe);
  
  const doc = iframe.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
    
    // Wait for fonts/styles to parse
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      // Remove iframe after print dialog is closed or cancelled
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 1000);
    }, 250);
  }
};

export const downloadHtmlReport = (items: OrderItem[], scope: string, excludedCount: number) => {
  const html = generateHtmlReport(items, scope, excludedCount);
  // Inject auto-print script
  const finalHtml = html.replace('</body>', '<script>window.onload = () => window.print();</script></body>');
  
  const blob = new Blob([finalHtml], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Report_${new Date().toISOString().split('T')[0]}.html`;
  link.click();
  URL.revokeObjectURL(url);
};
