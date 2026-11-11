export const reportKeys = [
  'stock-inventory',
  'low-stock',
  'stock-movements',
  'work-orders',
  'mrs',
  'issuance',
  'receiving',
  'stock-transfers',
] as const;

export type ReportKey = (typeof reportKeys)[number];
export type ReportRowValue = string | number | null;
export type ReportRow = Record<string, ReportRowValue>;

export type ReportFilters = {
  from?: string;
  to?: string;
  warehouse?: string;
  status?: string;
  department?: string;
  requestType?: string;
  movementType?: string;
};

export type ReportColumn = {
  key: string;
  label: string;
};

export const reportDefinitions: Record<ReportKey, { title: string; description: string; columns: ReportColumn[] }> = {
  'stock-inventory': {
    title: 'Stock Inventory Report',
    description: 'Current on-hand inventory by item and warehouse.',
    columns: [
      { key: 'itemCode', label: 'Item Code' },
      { key: 'name', label: 'Name' },
      { key: 'category', label: 'Category' },
      { key: 'quantity', label: 'Quantity' },
      { key: 'unit', label: 'Unit' },
      { key: 'reorderLevel', label: 'Reorder Level' },
      { key: 'location', label: 'Location' },
    ],
  },
  'low-stock': {
    title: 'Low Stock Report',
    description: 'Items at or below their warehouse reorder level.',
    columns: [
      { key: 'itemCode', label: 'Item Code' },
      { key: 'name', label: 'Name' },
      { key: 'category', label: 'Category' },
      { key: 'quantity', label: 'Quantity' },
      { key: 'unit', label: 'Unit' },
      { key: 'reorderLevel', label: 'Reorder Level' },
      { key: 'location', label: 'Location' },
    ],
  },
  'stock-movements': {
    title: 'Stock Movement Report',
    description: 'Auditable changes to warehouse stock.',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'item', label: 'Item' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'type', label: 'Type' },
      { key: 'quantity', label: 'Qty Change' },
      { key: 'quantityAfter', label: 'Qty After' },
      { key: 'reference', label: 'Reference' },
      { key: 'performedBy', label: 'Performed By' },
    ],
  },
  'work-orders': {
    title: 'Job Order Report',
    description: 'Job orders by status, date, department, and request type.',
    columns: [
      { key: 'workOrder', label: 'Job Order' },
      { key: 'date', label: 'Date Requested' },
      { key: 'department', label: 'Department' },
      { key: 'requestType', label: 'Request Type' },
      { key: 'status', label: 'Status' },
      { key: 'requestedBy', label: 'Requested By' },
      { key: 'equipment', label: 'Equipment' },
      { key: 'priority', label: 'Priority' },
      { key: 'itemCount', label: 'Material Lines' },
    ],
  },
  mrs: {
    title: 'MRS Report',
    description: 'Material requisition status and linked job-order details.',
    columns: [
      { key: 'mrsNumber', label: 'MRS Number' },
      { key: 'workOrder', label: 'Job Order' },
      { key: 'date', label: 'Date Requested' },
      { key: 'department', label: 'Department' },
      { key: 'requestedBy', label: 'Requested By' },
      { key: 'status', label: 'Status' },
      { key: 'itemCount', label: 'Item Lines' },
    ],
  },
  issuance: {
    title: 'Issuance Report',
    description: 'Items issued from approved Material Requisition Slips.',
    columns: [
      { key: 'date', label: 'Date Issued' },
      { key: 'mrsNumber', label: 'MRS Number' },
      { key: 'itemCode', label: 'Item Code' },
      { key: 'item', label: 'Item' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'quantity', label: 'Quantity Issued' },
      { key: 'department', label: 'Department' },
      { key: 'performedBy', label: 'Issued By' },
    ],
  },
  receiving: {
    title: 'Receiving Report Log',
    description: 'Receiving reports with delivery receipt and invoice references.',
    columns: [
      { key: 'rrNumber', label: 'RR Number' },
      { key: 'date', label: 'Date Received' },
      { key: 'drNumber', label: 'DR Number' },
      { key: 'invoiceNumber', label: 'Invoice Number' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'receivedBy', label: 'Received By' },
      { key: 'itemCount', label: 'Item Lines' },
    ],
  },
  'stock-transfers': {
    title: 'Stock Transfer Report',
    description: 'Transfer records and their items between warehouses.',
    columns: [
      { key: 'transferNo', label: 'Transfer Number' },
      { key: 'date', label: 'Date Transferred' },
      { key: 'transferredFrom', label: 'From Warehouse' },
      { key: 'transferredTo', label: 'To Warehouse' },
      { key: 'itemCode', label: 'Item Code' },
      { key: 'item', label: 'Item' },
      { key: 'quantity', label: 'Quantity' },
      { key: 'performedBy', label: 'Performed By' },
    ],
  },
};

export const reportNavigation: Array<{ key: ReportKey; label: string }> = [
  { key: 'stock-inventory', label: 'Stock Inventory Report' },
  { key: 'low-stock', label: 'Low Stock Report' },
  { key: 'stock-movements', label: 'Stock Movement Report' },
  { key: 'work-orders', label: 'Job Order Report' },
  { key: 'mrs', label: 'MRS Report' },
  { key: 'issuance', label: 'Issuance Report' },
  { key: 'receiving', label: 'Receiving Report Log' },
  { key: 'stock-transfers', label: 'Stock Transfer Report' },
];
