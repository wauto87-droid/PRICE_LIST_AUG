export interface OrderItem {
  id: string; // Unique row ID (e.g. `item-${index}`)
  index: number; // Row index
  date: string; // YYYY-MM-DD or raw string
  docNo: string | number; // Document / invoice number
  customer: string; // Customer / Company Name (trimmed)
  customerCode?: string; // Optional customer code
  itemCode: string; // SKU or Item Code
  itemName: string; // Full Item Description
  unit: string; // PCS, MTR, BOX, ROLL, etc.
  qty: number; // Ordered quantity
  invoiced: number; // Fulfilled / invoiced quantity
  invoiceRet: number; // Invoice returned quantity (Column I)
  deliveryRet: number; // Delivery returned quantity (Column J)
  balance: number; // Outstanding balance (Column K)
  status: 'pending' | 'partial' | 'returned' | 'completed' | 'unset';
  rawRow?: any[];
}

export interface Preset {
  id: string;
  name: string;
  excludedCompanies: string[];
}

export interface GlobalFilters {
  balanceFilter: 'ALL' | 'PENDING' | 'SETTLED';
  unitFilter: string;
  searchQuery: string;
  sortField: 'customer' | 'docNo' | 'date' | 'balance' | '';
  sortOrder: 'asc' | 'desc';
  excludedCustomers: string[];
  activePresetId: string | null;
}
