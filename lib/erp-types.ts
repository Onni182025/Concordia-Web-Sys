export type Role =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'ACCOUNTING'
  | 'FARM_WH_SUPERVISOR'
  | 'FARM_WH_PERSONNEL'
  | 'ENGINEERING_SUPERVISOR'
  | 'ENGINEERING_WH_PERSONNEL'
  | 'SALES_MANAGER'
  | 'EGG_ROOM_SUPERVISOR'
  | 'SALES_SUPERVISOR'
  | 'ADMIN_SUPERVISOR'
  | 'HR_SUPERVISOR'
  | 'MARKETING_SUPERVISOR'
  | 'PROCESS_ENGINEER'
  | 'EGG_ROOM_STAFF'
  | 'SALES_STAFF'
  | 'ADMIN_STAFF'
  | 'HR_ASSISTANT'
  | 'MARKETING_OFFICER'
  | 'MARKETING_STAFF'
  | 'PROCESS_ANALYST'
  | 'STAFF';
export type Permission =
  | 'dashboard:view'
  | 'work-orders:view'
  | 'work-orders:create'
  | 'work-orders:approve'
  | 'work-orders:mrrf:approve'
  | 'mrs:view'
  | 'mrs:create'
  | 'mrs:approve'
  | 'mrs:issue'
  | 'inventory:view'
  | 'inventory:manage'
  | 'inventory:issue'
  | 'inventory:transfer'
  | 'receiving:view'
  | 'receiving:create'
  | 'receiving:attachments:upload'
  | 'movements:view'
  | 'reports:view'
  | 'users:view'
  | 'users:create'
  | 'users:update'
  | 'users:deactivate'
  | 'users:create-super-admin'
  | 'settings:manage';
export type Warehouse = 'ENGINEERING' | 'FARM';
export type RequestType = 'MRRF' | 'EPRF';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type WorkOrderStatus = 'PENDING' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED';
export type MRSStatus = 'PENDING' | 'APPROVED' | 'ISSUED' | 'FULFILLED' | 'REJECTED';

export interface User { id: string; employeeId?: string; email: string; name: string; role: Role; permissions?: Permission[]; department?: string; isActive: boolean; password?: string; createdAt: string; }
export interface Item { id: string; code: string; name: string; description: string; category: string; unit: string; }
export interface WarehouseStock { id: string; itemId: string; warehouse: Warehouse; quantity: number; minStockLevel: number; }
export interface WorkOrderItem { id: string; workOrderId: string; itemId: string; quantityNeeded: number; quantityIssued: number; item?: { id: string; code: string; name: string; unit: string }; }
export interface WorkOrderMRSItem { id: string; itemId?: string; quantityRequested: number; quantityIssued: number; }
export interface WorkOrderMRS { id: string; mrsNumber: string; status: MRSStatus; dateRequested: string; createdAt: string; itemCount: number; items: WorkOrderMRSItem[]; }
export interface WorkOrder { id: string; woNumber: string; type: RequestType; dateRequested: string; dateNeeded: string; department: string; machineEquipment: string; areaBuilding: string; specification: string; description: string; priority: Priority; requestedBy: string; status: WorkOrderStatus; createdById: string; createdAt: string; cancelledBy?: string; cancelledAt?: string; cancelReason?: string; items?: WorkOrderItem[]; mrsList?: WorkOrderMRS[]; }
export interface MRSItem { id: string; mrsId: string; itemId?: string; customItemName?: string; description?: string; unit?: string; quantityRequested: number; quantityApproved: number; quantityIssued: number; purpose?: string; notInInventory?: boolean; purchaseRequestStatus?: string; }
export interface MRS { id: string; mrsNumber: string; workOrderId?: string; purposeCategory: string; otherPurpose?: string; department?: string; dateRequested?: string; dateNeeded?: string; requestedBy: string; preparedBy?: string; status: MRSStatus; createdById: string; createdAt: string; cancelledBy?: string; cancelledAt?: string; cancelReason?: string; items?: MRSItem[]; issuedAt?: string; issuedBy?: string; issuedWarehouse?: Warehouse; }
export interface ReceivingItem { id: string; receivingId: string; itemId: string; qtyReceived: number; unitCost: number; category: string; reorderLevel: number; item?: { code: string; name: string; unit: string }; }
export interface ReceivingAttachment { id: string; type: 'DELIVERY_RECEIPT' | 'INVOICE'; fileName: string; mimeType: string; }
export interface Receiving { id: string; rrNumber: string; drNumber: string; invoiceNumber: string; warehouse: Warehouse; receivedBy: string; receivedDate: string; drFileUrl?: string; invoiceFileUrl?: string; attachments?: ReceivingAttachment[]; items?: ReceivingItem[]; }
export interface StockMovement { id: string; itemId: string; warehouse: Warehouse; quantity: number; quantityAfter: number; type: 'RECEIVING' | 'ISSUANCE' | 'RESTOCK' | 'ADJUSTMENT' | 'TRANSFER'; referenceId: string; referenceType: string; createdBy: string; createdAt: string; documentNumber?: string; supplier?: string; remarks?: string; }
