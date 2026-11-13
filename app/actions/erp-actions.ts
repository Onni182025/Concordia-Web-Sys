'use server';

import { prisma } from '@/src/lib/prisma';
import { can, canDisapproveRequest, canManageUser, stockSubLocationsForRole, warehouseForRole } from '@/lib/rbac';
import { requireAuthenticatedUser, requirePermission, requireWarehousePermission } from '@/lib/rbac-server';
import bcrypt from 'bcryptjs';
import { Prisma, type DocumentSeriesType } from '@prisma/client';
import { z } from 'zod';
import type { Item, MRS, MRSItem, Receiving, StockMovement, User, Warehouse, WarehouseStock, WorkOrder, WorkOrderItem } from '@/lib/erp-types';
import { mrsFormSchema, type MRSFormValues } from '@/lib/schemas/mrs-schema';
import { workOrderFormSchema } from '@/lib/schemas/work-order-schema';

const dateOnly = (value: Date) => value.toISOString().split('T')[0];
const numberValue = (value: unknown) => Number(value);
const userDto = (value: any): User => ({ ...value, createdAt: dateOnly(value.createdAt), password: undefined });
const itemDto = (value: any): Item => ({ id: value.id, code: value.code, name: value.name, description: value.description || '', category: value.category, unit: value.unit });
const stockDto = (value: any): WarehouseStock => ({ id: value.id, itemId: value.itemId, warehouse: value.warehouse, subLocation: value.subLocation || 'Unspecified', quantity: numberValue(value.quantity), minStockLevel: numberValue(value.minStockLevel) });
const workOrderItemDto = (value: any): WorkOrderItem => ({ id: value.id, workOrderId: value.workOrderId, itemId: value.itemId, quantityNeeded: numberValue(value.quantityNeeded), quantityIssued: numberValue(value.quantityIssued), item: value.item ? { id: value.item.id, code: value.item.code, name: value.item.name, unit: value.item.unit } : undefined });
const mrsItemDto = (value: any): MRSItem => ({ id: value.id, mrsId: value.mrsId, itemId: value.itemId || undefined, customItemName: value.customItemName || undefined, description: value.description || undefined, unit: value.unit || undefined, quantityRequested: numberValue(value.quantityRequested), quantityApproved: numberValue(value.quantityApproved), quantityIssued: numberValue(value.quantityIssued), purpose: value.purpose || undefined, notInInventory: value.notInInventory, purchaseRequestStatus: value.purchaseRequestStatus || undefined });
const workOrderDto = (value: any): WorkOrder => ({ id: value.id, woNumber: value.woNumber, type: value.type, dateRequested: dateOnly(value.dateRequested), dateNeeded: dateOnly(value.dateNeeded), department: value.department, machineEquipment: value.machineEquipment, areaBuilding: value.areaBuilding, specification: value.specification, description: value.description, priority: value.priority, requestedBy: value.requestedBy, status: value.status, createdById: value.createdById, createdAt: dateOnly(value.createdAt), cancelledBy: value.cancelledBy || undefined, cancelledAt: value.cancelledAt?.toISOString(), cancelReason: value.cancelReason || undefined, editedBy: value.editedBy || undefined, editedAt: value.editedAt?.toISOString(), disapprovedBy: value.disapprovedBy || undefined, disapprovedAt: value.disapprovedAt?.toISOString(), disapproveReason: value.disapproveReason || undefined, items: value.items?.map(workOrderItemDto), ...(value.mrsList ? { mrsList: value.mrsList.map((mrs: any) => ({ id: mrs.id, mrsNumber: mrs.mrsNumber, status: mrs.status, dateRequested: dateOnly(mrs.dateRequested), createdAt: dateOnly(mrs.createdAt), itemCount: mrs.items.length, disapprovedBy: mrs.disapprovedBy || undefined, items: mrs.items.map((item: any) => ({ id: item.id, itemId: item.itemId || undefined, quantityRequested: numberValue(item.quantityRequested), quantityIssued: numberValue(item.quantityIssued) })) })) } : {}) });
const mrsDto = (value: any): MRS => ({ id: value.id, mrsNumber: value.mrsNumber, workOrderId: value.workOrderId || undefined, purposeCategory: value.purposeCategory, department: value.department, dateRequested: dateOnly(value.dateRequested), dateNeeded: dateOnly(value.dateNeeded), requestedBy: value.requestedBy, preparedBy: value.preparedBy, status: value.status, createdById: value.createdById, createdAt: dateOnly(value.createdAt), cancelledBy: value.cancelledBy || undefined, cancelledAt: value.cancelledAt?.toISOString(), cancelReason: value.cancelReason || undefined, editedBy: value.editedBy || undefined, editedAt: value.editedAt?.toISOString(), disapprovedBy: value.disapprovedBy || undefined, disapprovedAt: value.disapprovedAt?.toISOString(), disapproveReason: value.disapproveReason || undefined, items: value.items?.map(mrsItemDto) });

async function writeAuditLog(
  tx: Prisma.TransactionClient,
  actor: { id: string; name: string },
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, string | number | boolean>,
) {
  await tx.auditLog.create({
    data: {
      actorUserId: actor.id,
      actorName: actor.name,
      action,
      entityType,
      entityId,
      details: details ? JSON.stringify(details) : undefined,
    },
  });
}

const defaultDocumentSeries: Record<DocumentSeriesType, { prefix: string; nextNumber: number; padding: number; yearFormat: string | null }> = {
  WORK_ORDER: { prefix: 'WO-', nextNumber: 1, padding: 4, yearFormat: 'YYYY' },
  MRS: { prefix: 'MRS-', nextNumber: 1, padding: 4, yearFormat: 'YYYY' },
  RECEIVING: { prefix: 'RR-', nextNumber: 1, padding: 4, yearFormat: 'YYYY' },
};
const maximumDocumentSeriesNumber = 2147483647;

const formatDocumentNumber = (
  series: { prefix: string; nextNumber: number; padding: number; yearFormat: string | null },
  number: number,
  date = new Date(),
) => {
  const year = series.yearFormat === 'YYYY'
    ? `${date.getFullYear()}-`
    : series.yearFormat === 'YY'
      ? `${String(date.getFullYear()).slice(-2)}-`
      : '';
  return `${series.prefix}${year}${String(number).padStart(series.padding, '0')}`;
};

async function ensureDocumentSeries(tx: Prisma.TransactionClient, type: DocumentSeriesType) {
  return tx.documentSeries.upsert({
    where: { type },
    update: {},
    create: { type, ...defaultDocumentSeries[type] },
  });
}

async function allocateDocumentNumber(tx: Prisma.TransactionClient, type: DocumentSeriesType) {
  let series = await ensureDocumentSeries(tx, type);
  if (series.nextNumber >= maximumDocumentSeriesNumber) throw new Error('The document number series has reached its maximum value.');
  let number = series.nextNumber;
  let nextSeries = await tx.documentSeries.update({ where: { type }, data: { nextNumber: { increment: 1 } } });
  while (true) {
    const candidate = formatDocumentNumber(series, number);
    const exists = type === 'WORK_ORDER'
      ? await tx.workOrder.findUnique({ where: { woNumber: candidate }, select: { id: true } })
      : type === 'MRS'
        ? await tx.mRS.findUnique({ where: { mrsNumber: candidate }, select: { id: true } })
        : await tx.receiving.findUnique({ where: { rrNumber: candidate }, select: { id: true } });
    if (!exists) return candidate;
    number = nextSeries.nextNumber;
    if (number >= maximumDocumentSeriesNumber) throw new Error('The document number series has reached its maximum value.');
    series = nextSeries;
    nextSeries = await tx.documentSeries.update({ where: { type }, data: { nextNumber: { increment: 1 } } });
  }
}

export async function getDocumentNumberPreview(type: DocumentSeriesType, userId: string) {
  const permission = type === 'WORK_ORDER' ? 'work-orders:create' : type === 'MRS' ? 'mrs:create' : 'receiving:create';
  await requirePermission(userId, permission);
  const series = await prisma.documentSeries.findUnique({ where: { type } });
  const fallback = defaultDocumentSeries[type];
  return formatDocumentNumber(series || fallback, series?.nextNumber ?? fallback.nextNumber);
}

export async function getDocumentSeriesSettings(userId: string) {
  await requirePermission(userId, 'settings:manage');
  return Promise.all((Object.keys(defaultDocumentSeries) as DocumentSeriesType[]).map(type =>
    prisma.documentSeries.upsert({
      where: { type },
      update: {},
      create: { type, ...defaultDocumentSeries[type] },
    }),
  ));
}

export async function getDashboardData(userId: string) {
  const actor = await requireAuthenticatedUser(userId);
  const canViewWorkOrders = can(actor.role, 'work-orders:view', actor.permissions);
  const canViewMRS = can(actor.role, 'mrs:view', actor.permissions);
  const canViewInventory = can(actor.role, 'inventory:view', actor.permissions);

  const [pendingWorkOrders, recentWorkOrders, pendingMRS, itemCount, lowStockCount, lowStockRows] = await Promise.all([
    canViewWorkOrders ? prisma.workOrder.count({ where: { status: 'PENDING' } }) : Promise.resolve(0),
    canViewWorkOrders ? prisma.workOrder.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        woNumber: true,
        type: true,
        dateRequested: true,
        dateNeeded: true,
        department: true,
        machineEquipment: true,
        areaBuilding: true,
        specification: true,
        description: true,
        priority: true,
        requestedBy: true,
        status: true,
        createdById: true,
        createdAt: true,
        cancelledBy: true,
        cancelledAt: true,
        cancelReason: true,
      },
    }) : Promise.resolve([]),
    canViewMRS ? prisma.mRS.count({ where: { status: 'PENDING' } }) : Promise.resolve(0),
    canViewInventory ? prisma.item.count() : Promise.resolve(0),
    canViewInventory ? prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM "WarehouseStock"
      WHERE quantity <= "minStockLevel"
    `.then(rows => rows[0]?.count || 0) : Promise.resolve(0),
    canViewInventory ? prisma.$queryRaw<Array<{
      id: string;
      warehouse: Warehouse;
      quantity: unknown;
      minStockLevel: unknown;
      itemName: string;
      itemCode: string;
      unit: string;
    }>>`
      SELECT ws.id, ws.warehouse, ws.quantity, ws."minStockLevel",
        i.name AS "itemName", i.code AS "itemCode", i.unit
      FROM "WarehouseStock" ws
      JOIN "Item" i ON i.id = ws."itemId"
      WHERE ws.quantity <= ws."minStockLevel"
      ORDER BY ws.quantity ASC, i.name ASC
    ` : Promise.resolve([]),
  ]);

  return {
    pendingWorkOrders,
    recentWorkOrders: recentWorkOrders.map(workOrderDto),
    pendingMRS,
    itemCount,
    lowStockCount,
    lowStockItems: lowStockRows.map(stock => ({
      id: stock.id,
      warehouse: stock.warehouse,
      quantity: numberValue(stock.quantity),
      minStockLevel: numberValue(stock.minStockLevel),
      itemName: stock.itemName,
      itemCode: stock.itemCode,
      unit: stock.unit,
    })),
  };
}

export async function updateDocumentSeries(input: {
  userId: string;
  type: DocumentSeriesType;
  prefix: string;
  nextNumber: number;
  padding: number;
  yearFormat: '' | 'YYYY' | 'YY';
}) {
  await requirePermission(input.userId, 'settings:manage');
  const prefix = input.prefix.trim();
  if (!prefix) throw new Error('A document prefix is required.');
  if (!Number.isInteger(input.nextNumber) || input.nextNumber < 1 || input.nextNumber >= maximumDocumentSeriesNumber) {
    throw new Error('Next number must be a positive whole number.');
  }
  if (!Number.isInteger(input.padding) || input.padding < 1 || input.padding > 12) {
    throw new Error('Number padding must be between 1 and 12 digits.');
  }
  if (!['', 'YYYY', 'YY'].includes(input.yearFormat)) throw new Error('Select a supported year format.');
  return prisma.documentSeries.upsert({
    where: { type: input.type },
    update: { prefix, nextNumber: input.nextNumber, padding: input.padding, yearFormat: input.yearFormat || null },
    create: { type: input.type, prefix, nextNumber: input.nextNumber, padding: input.padding, yearFormat: input.yearFormat || null },
  });
}

export async function getInventoryData(userId: string) {
  await requirePermission(userId, 'inventory:view');
  const [items, stocks, issuance] = await Promise.all([prisma.item.findMany({ orderBy: { name: 'asc' } }), prisma.warehouseStock.findMany(), prisma.stockMovement.groupBy({ by: ['itemId'], where: { type: 'ISSUANCE' }, _sum: { quantity: true } })]);
  return { items: items.map(itemDto), stocks: stocks.map(stockDto), issuanceTotals: Object.fromEntries(issuance.map(value => [value.itemId, Math.abs(numberValue(value._sum.quantity))])) };
}

const inventoryStockRowSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required'),
  code: z.string().trim().min(1, 'Item code is required'),
  category: z.string().trim().min(1, 'Category is required'),
  quantity: z.number().finite().min(0, 'Quantity cannot be negative'),
  unit: z.string().trim().min(1, 'Unit is required'),
  reorderLevel: z.number().finite().min(0, 'Reorder level cannot be negative'),
  location: z.enum(['FARM', 'ENGINEERING']),
  subLocation: z.string().trim().min(1, 'Select a stock sub-location'),
});
type BulkStockRow = z.infer<typeof inventoryStockRowSchema>;
const disapprovalReasonSchema = z.string().trim().min(1, 'A disapproval reason is required.').max(2000, 'Disapproval reason must be 2,000 characters or fewer.');

export async function saveInventoryItem(input: { id?: string; name: string; code: string; category: string; description?: string; unit: string; quantity: number; reorderLevel: number; location: Warehouse; subLocation: string; createdBy?: string; userId: string }) {
  const actor = await requireWarehousePermission(input.userId, 'inventory:manage', input.location);
  const value = inventoryStockRowSchema.parse(input);
  if (!stockSubLocationsForRole(actor.role, value.location).includes(value.subLocation)) {
    throw new Error('Select a stock sub-location authorized for your role and warehouse.');
  }
  return prisma.$transaction(async tx => {
    const item = input.id
      ? await tx.item.update({ where: { id: input.id }, data: { name: value.name, code: value.code, category: value.category, description: input.description, unit: value.unit } })
      : await tx.item.create({ data: { name: value.name, code: value.code, category: value.category, description: input.description, unit: value.unit } });
    const existingStock = await tx.warehouseStock.findUnique({ where: { itemId_warehouse: { itemId: item.id, warehouse: value.location } } });
    const previousQuantity = existingStock ? Number(existingStock.quantity) : 0;
    const stock = await tx.warehouseStock.upsert({
      where: { itemId_warehouse: { itemId: item.id, warehouse: value.location } },
      update: { quantity: value.quantity, minStockLevel: value.reorderLevel, subLocation: value.subLocation },
      create: { itemId: item.id, warehouse: value.location, subLocation: value.subLocation, quantity: value.quantity, minStockLevel: value.reorderLevel },
    });
    const quantityChange = value.quantity - previousQuantity;
    if (quantityChange !== 0) {
      await tx.stockMovement.create({
        data: {
          itemId: item.id,
          warehouse: value.location,
          quantity: quantityChange,
          quantityAfter: stock.quantity,
          type: quantityChange > 0 ? 'RESTOCK' : 'ADJUSTMENT',
          referenceId: item.code,
          referenceType: quantityChange > 0 ? 'RESTOCK' : 'ADJUSTMENT',
          createdBy: actor.name,
          remarks: `Inventory quantity initialized or manually adjusted at ${value.subLocation}.`,
        },
      });
    }
    return itemDto(item);
  });
}

export async function bulkCreateInventoryItems(input: { rows: unknown[]; userId: string }) {
  const actor = await requirePermission(input.userId, 'inventory:manage');
  if (!Array.isArray(input.rows) || input.rows.length === 0) throw new Error('Add at least one stock item row.');
  if (input.rows.length > 100) throw new Error('Bulk entry is limited to 100 rows per submission.');

  const errors: Array<{ row: number; message: string }> = [];
  const validRows: Array<{ row: number; value: BulkStockRow }> = [];
  const seenCodes = new Set<string>();
  input.rows.forEach((rawValue, index) => {
    const rowNumber = index + 1;
    const parsed = inventoryStockRowSchema.safeParse(rawValue);
    if (!parsed.success) {
      errors.push({ row: rowNumber, message: parsed.error.issues[0]?.message || 'Check this row.' });
      return;
    }
    const value = parsed.data;
    const restrictedWarehouse = warehouseForRole(actor.role);
    if (restrictedWarehouse && value.location !== restrictedWarehouse) {
      errors.push({ row: rowNumber, message: 'Warehouse is outside your role assignment.' });
      return;
    }
    if (!stockSubLocationsForRole(actor.role, value.location).includes(value.subLocation)) {
      errors.push({ row: rowNumber, message: 'Sub-location is not authorized for this role and warehouse.' });
      return;
    }
    const normalizedCode = value.code.toLocaleLowerCase();
    if (seenCodes.has(normalizedCode)) {
      errors.push({ row: rowNumber, message: `Item code "${value.code}" is duplicated in this submission.` });
      return;
    }
    seenCodes.add(normalizedCode);
    validRows.push({ row: rowNumber, value });
  });

  const existing = await prisma.item.findMany({
    where: { code: { in: validRows.map(row => row.value.code) } },
    select: { code: true },
  });
  const existingCodes = new Set(existing.map(item => item.code.toLocaleLowerCase()));
  const rowsToCreate = validRows.filter(row => {
    if (!existingCodes.has(row.value.code.toLocaleLowerCase())) return true;
    errors.push({ row: row.row, message: `Item code "${row.value.code}" already exists.` });
    return false;
  });
  const createdItems = await prisma.$transaction(async tx => {
    const created: Item[] = [];
    for (const { value } of rowsToCreate) {
      const item = await tx.item.create({
        data: { name: value.name, code: value.code, category: value.category, unit: value.unit },
      });
      const stock = await tx.warehouseStock.create({
        data: {
          itemId: item.id,
          warehouse: value.location,
          subLocation: value.subLocation,
          quantity: value.quantity,
          minStockLevel: value.reorderLevel,
        },
      });
      if (value.quantity > 0) {
        await tx.stockMovement.create({
          data: {
            itemId: item.id,
            warehouse: value.location,
            quantity: value.quantity,
            quantityAfter: stock.quantity,
            type: 'RESTOCK',
            referenceId: item.code,
            referenceType: 'RESTOCK',
            createdBy: actor.name,
            remarks: `Initial bulk stock entry at ${value.subLocation}.`,
          },
        });
      }
      created.push(itemDto(item));
    }
    return created;
  });
  return { createdCount: createdItems.length, errors, items: createdItems };
}

export async function restockInventory(input: { itemId: string; warehouse: Warehouse; quantity: number; documentNumber: string; supplier: string; remarks?: string; createdBy: string; userId: string }) {
  const actor = await requireWarehousePermission(input.userId, 'inventory:manage', input.warehouse);
  return prisma.$transaction(async tx => {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error('Restock quantity must be greater than zero.');
    const stock = await tx.warehouseStock.upsert({ where: { itemId_warehouse: { itemId: input.itemId, warehouse: input.warehouse } }, update: { quantity: { increment: input.quantity } }, create: { itemId: input.itemId, warehouse: input.warehouse, quantity: input.quantity, minStockLevel: 5 } });
    await tx.stockMovement.create({ data: { itemId: input.itemId, warehouse: input.warehouse, quantity: input.quantity, quantityAfter: stock.quantity, type: 'RESTOCK', referenceId: input.documentNumber, referenceType: 'RESTOCK', createdBy: actor.name, documentNumber: input.documentNumber, supplier: input.supplier, remarks: input.remarks } });
    return stockDto(stock);
  });
}

export async function deleteInventoryItem(itemId: string, userId: string) {
  const actor = await requirePermission(userId, 'inventory:manage');
  if (warehouseForRole(actor.role)) {
    return { ok: false as const, error: 'Only users with access to both warehouses can delete an inventory item.' };
  }

  try {
    return await prisma.$transaction(async tx => {
      const item = await tx.item.findUnique({
        where: { id: itemId },
        select: {
          _count: {
            select: {
              workOrderItems: true,
              mrsItems: true,
              receivingItems: true,
              movements: true,
              transferItems: true,
            },
          },
        },
      });
      if (!item) return { ok: false as const, error: 'This inventory item no longer exists.' };

      const linkedRecords = Object.values(item._count).reduce((total, count) => total + count, 0);
      if (linkedRecords > 0) {
        return {
          ok: false as const,
          error: 'This item is linked to existing inventory or request records and cannot be deleted without removing its history.',
        };
      }

      await tx.item.delete({ where: { id: itemId } });
      return { ok: true as const };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return {
        ok: false as const,
        error: 'This item was linked to another record while deletion was in progress. Refresh the list and try again.',
      };
    }
    throw error;
  }
}

export async function getMRSPageReferenceData(userId: string) {
  await requirePermission(userId, 'mrs:view');
  const [items, workOrders] = await Promise.all([
    prisma.item.findMany({ orderBy: { name: 'asc' } }),
    prisma.workOrder.findMany({ select: { id: true, woNumber: true } }),
  ]);
  return { items: items.map(itemDto), workOrders };
}

export async function getMRSFormData(userId: string) {
  await requirePermission(userId, 'mrs:create');
  const [items, stocks, workOrders] = await Promise.all([
    prisma.item.findMany({
      select: { id: true, code: true, name: true, description: true, category: true, unit: true },
      orderBy: { name: 'asc' },
    }),
    prisma.warehouseStock.findMany({
      select: { id: true, itemId: true, warehouse: true, quantity: true, minStockLevel: true },
    }),
    prisma.workOrder.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        woNumber: true,
        type: true,
        dateNeeded: true,
        department: true,
        machineEquipment: true,
        description: true,
        requestedBy: true,
        status: true,
        items: { select: { itemId: true, quantityNeeded: true } },
        mrsList: {
          where: { status: { not: 'REJECTED' } },
          select: {
            status: true,
            items: { select: { itemId: true, quantityRequested: true } },
          },
        },
      },
    }),
  ]);
  return {
    items: items.map(itemDto),
    stocks: stocks.map(stockDto),
    workOrders: workOrders.map(order => ({
      ...order,
      dateNeeded: dateOnly(order.dateNeeded),
      items: order.items.map(item => ({
        itemId: item.itemId,
        quantityNeeded: numberValue(item.quantityNeeded),
      })),
      mrsList: order.mrsList.map(mrs => ({
        status: mrs.status,
        items: mrs.items.map(item => ({
          itemId: item.itemId || undefined,
          quantityRequested: numberValue(item.quantityRequested),
        })),
      })),
    })),
  };
}

export async function createMRS(input: { workOrderId?: string; workOrderReference?: string; purposeCategory: string; department: string; dateRequested: string; dateNeeded: string; requestedBy: string; preparedBy: string; createdById: string; items: Array<{ itemId?: string; customItemName?: string; description?: string; unit?: string; quantityRequested: number; purpose?: string; notInInventory?: boolean }> }) {
  try {
    await requirePermission(input.createdById, 'mrs:create');
    return await prisma.$transaction(async tx => {
      const workOrderReference = input.workOrderReference?.trim();
      const hasWorkOrderReference = input.workOrderReference !== undefined;
      const workOrder = hasWorkOrderReference
        ? workOrderReference
          ? await tx.workOrder.findUnique({
            where: { woNumber: workOrderReference },
            include: { items: true, mrsList: { where: { status: { not: 'REJECTED' } }, include: { items: true } } },
          })
          : null
        : input.workOrderId
          ? await tx.workOrder.findUnique({
            where: { id: input.workOrderId },
            include: { items: true, mrsList: { where: { status: { not: 'REJECTED' } }, include: { items: true } } },
          })
          : null;

      if ((workOrderReference || (!hasWorkOrderReference && input.workOrderId)) && !workOrder) {
        return { ok: false as const, error: workOrderReference
          ? `Job Order "${workOrderReference}" was not found. Select a valid Job Order or clear the reference.`
          : 'The linked Job Order was not found. Select a valid Job Order or clear the reference.' };
      }
      if (workOrder && (workOrder.status === 'COMPLETED' || workOrder.status === 'REJECTED')) {
        return { ok: false as const, error: 'A completed or cancelled Job Order cannot receive a new MRS.' };
      }

      if (workOrder) {
        const requestedByItem = new Map<string, number>();
        for (const request of input.items.filter(item => item.itemId)) {
          requestedByItem.set(request.itemId!, (requestedByItem.get(request.itemId!) || 0) + request.quantityRequested);
        }
        for (const [itemId, requestQuantity] of requestedByItem) {
          const required = workOrder.items.filter(item => item.itemId === itemId).reduce((total, item) => total + Number(item.quantityNeeded), 0);
          if (required === 0) {
            return { ok: false as const, error: 'This Job Order has no matching material requirement. Add the item to the Job Order first, or clear the Job Order reference.' };
          }
          const alreadyRequested = workOrder.mrsList.flatMap(mrs => mrs.items)
            .filter(item => item.itemId === itemId)
            .reduce((total, item) => total + Number(item.quantityRequested), 0);
          if (alreadyRequested + requestQuantity > required) {
            return { ok: false as const, error: 'The requested quantity exceeds the remaining Job Order material requirement.' };
          }
        }
      }

      const mrsNumber = await allocateDocumentNumber(tx, 'MRS');
      const created = await tx.mRS.create({
        data: {
          mrsNumber,
          workOrderId: workOrder?.id || null,
          purposeCategory: input.purposeCategory,
          department: input.department,
          dateRequested: new Date(input.dateRequested),
          dateNeeded: new Date(input.dateNeeded),
          requestedBy: input.requestedBy,
          preparedBy: input.preparedBy,
          createdById: input.createdById,
          items: {
            create: input.items.map(item => ({
              itemId: item.itemId || null,
              customItemName: item.customItemName,
              description: item.description,
              unit: item.unit,
              quantityRequested: item.quantityRequested,
              purpose: item.purpose,
              notInInventory: item.notInInventory || false,
              purchaseRequestStatus: item.notInInventory ? 'PENDING' : null,
            })),
          },
        },
        include: { items: true },
      });
      const purchaseItems = created.items.filter(value => value.notInInventory);
      if (purchaseItems.length > 0) {
        const createdAt = Date.now();
        await tx.purchaseRequisition.createMany({
          data: purchaseItems.map((item, index) => ({
            prNumber: `PR-${createdAt}-${index}-${item.id.slice(-4)}`,
            mrsItemId: item.id,
            requestedBy: input.requestedBy,
            department: input.department,
            remarks: item.purpose,
          })),
        });
      }
      return { ok: true as const, mrs: mrsDto(created) };
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[createMRS] Failed to create a material requisition:', error);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return { ok: false as const, error: 'The database could not save this requisition. Check for duplicate or invalid linked records and try again.' };
    }
    return {
      ok: false as const,
      error: process.env.NODE_ENV !== 'production' && error instanceof Error
        ? error.message
        : 'An unexpected error occurred while saving this requisition.',
    };
  }
}

export async function getMRSForEdit(mrsId: string, userId: string) {
  await requirePermission(userId, 'mrs:create');
  const mrs = await prisma.mRS.findUnique({
    where: { id: mrsId },
    include: { items: true, workOrder: { select: { woNumber: true } } },
  });
  if (!mrs) throw new Error('This Stock Requisition Slip no longer exists.');
  const canRework = mrs.status === 'REJECTED' && Boolean(mrs.disapprovedBy) && !mrs.cancelledBy;
  if (mrs.status !== 'PENDING' && !canRework) throw new Error('Only pending or disapproved Stock Requisition Slips can be edited.');
  return { ...mrsDto(mrs), workOrderReference: mrs.workOrder?.woNumber || '' };
}

export async function updateMRS(input: MRSFormValues & { id: string; userId: string }) {
  const actor = await requirePermission(input.userId, 'mrs:create');
  const values = mrsFormSchema.parse(input);
  return prisma.$transaction(async tx => {
    const current = await tx.mRS.findUnique({
      where: { id: input.id },
      include: { items: true },
    });
    if (!current) throw new Error('This Stock Requisition Slip no longer exists.');
    const canRework = current.status === 'REJECTED' && Boolean(current.disapprovedBy) && !current.cancelledBy;
    if (current.status !== 'PENDING' && !canRework) throw new Error('Only pending or disapproved Stock Requisition Slips can be edited.');

    const currentItemIds = current.items.map(item => item.id);
    if (currentItemIds.length > 0) {
      const activePurchaseRequest = await tx.purchaseRequisition.findFirst({
        where: { mrsItemId: { in: currentItemIds }, status: { not: 'PENDING' } },
        select: { id: true },
      });
      if (activePurchaseRequest) {
        throw new Error('This requisition has a purchase request already approved or ordered and cannot be edited.');
      }
    }

    const reference = values.workOrderReference?.trim();
    const workOrder = reference
      ? await tx.workOrder.findUnique({
        where: { woNumber: reference },
        include: {
          items: true,
          mrsList: {
            where: { id: { not: current.id }, status: { not: 'REJECTED' } },
            include: { items: true },
          },
        },
      })
      : null;
    if (reference && !workOrder) throw new Error(`Job Order "${reference}" was not found. Select a valid Job Order or clear the reference.`);
    if (workOrder && ['COMPLETED', 'REJECTED'].includes(workOrder.status)) {
      throw new Error('A completed or cancelled Job Order cannot receive a Stock Requisition Slip.');
    }

    if (workOrder) {
      const requests = new Map<string, number>();
      for (const item of values.items.filter(line => line.itemId)) {
        const itemId = item.itemId!;
        requests.set(itemId, (requests.get(itemId) || 0) + item.quantityRequested);
      }
      for (const [itemId, quantity] of requests) {
        const required = workOrder.items
          .filter(item => item.itemId === itemId)
          .reduce((total, item) => total + Number(item.quantityNeeded), 0);
        const previouslyRequested = workOrder.mrsList.flatMap(mrs => mrs.items)
          .filter(item => item.itemId === itemId)
          .reduce((total, item) => total + Number(item.quantityRequested), 0);
        if (required === 0 || previouslyRequested + quantity > required) {
          throw new Error('The requested items or quantities exceed the remaining Job Order material requirements.');
        }
      }
    }

    if (currentItemIds.length > 0) {
      await tx.purchaseRequisition.deleteMany({ where: { mrsItemId: { in: currentItemIds }, status: 'PENDING' } });
      await tx.mRSItem.deleteMany({ where: { id: { in: currentItemIds } } });
    }
    const updated = await tx.mRS.update({
      where: { id: current.id },
      data: {
        workOrderId: workOrder?.id || null,
        purposeCategory: values.purposeCategory,
        department: values.department.trim(),
        dateRequested: new Date(values.dateRequested),
        dateNeeded: new Date(values.dateNeeded),
        requestedBy: values.requestedBy.trim(),
        preparedBy: values.preparedBy.trim(),
        status: 'PENDING',
        editedBy: actor.name,
        editedAt: new Date(),
        disapprovedBy: null,
        disapprovedAt: null,
        disapproveReason: null,
        items: {
          create: values.items.map(item => ({
            itemId: item.itemId || null,
            customItemName: item.customItemName?.trim() || null,
            description: item.description?.trim() || null,
            unit: item.unit.trim(),
            quantityRequested: item.quantityRequested,
            purpose: item.purpose?.trim() || null,
            notInInventory: item.notInInventory,
            purchaseRequestStatus: item.notInInventory ? 'PENDING' : null,
          })),
        },
      },
      include: { items: true },
    });
    const purchaseItems = updated.items.filter(item => item.notInInventory);
    if (purchaseItems.length > 0) {
      await tx.purchaseRequisition.createMany({
        data: purchaseItems.map((item, index) => ({
          prNumber: `PR-${Date.now()}-${index}-${item.id.slice(-4)}`,
          mrsItemId: item.id,
          requestedBy: values.requestedBy.trim(),
          department: values.department.trim(),
          remarks: item.purpose,
        })),
      });
    }
    await writeAuditLog(tx, actor, 'SRS_UPDATED', 'MRS', current.id, { number: current.mrsNumber });
    return mrsDto(updated);
  });
}

export async function approveMRS(mrsId: string, userId: string) {
  await requirePermission(userId, 'mrs:approve');
  const updated = await prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user?.isActive) throw new Error('Only active users can approve material requisitions.');
    const current = await tx.mRS.findUniqueOrThrow({ where: { id: mrsId }, include: { items: true } });
    if (current.status !== 'PENDING') throw new Error('Only pending material requisitions can be approved.');
    await tx.mRS.update({ where: { id: mrsId }, data: { status: 'APPROVED' } });
    await Promise.all(current.items.map(item => tx.mRSItem.update({ where: { id: item.id }, data: { quantityApproved: item.quantityRequested } })));
    return tx.mRS.findUniqueOrThrow({ where: { id: mrsId }, include: { items: true } });
  });
  return mrsDto(updated);
}

export async function disapproveMRS(mrsId: string, reason: string, userId: string) {
  const actor = await requirePermission(userId, 'mrs:approve');
  if (!canDisapproveRequest(actor.role, 'mrs:approve', actor.permissions)) {
    throw new Error('You are not authorized to disapprove Stock Requisition Slips.');
  }
  const trimmedReason = disapprovalReasonSchema.parse(reason);
  return prisma.$transaction(async tx => {
    const current = await tx.mRS.findUniqueOrThrow({ where: { id: mrsId } });
    if (current.status !== 'PENDING') throw new Error('Only pending Stock Requisition Slips can be disapproved.');
    const updated = await tx.mRS.update({
      where: { id: mrsId },
      data: { status: 'REJECTED', disapprovedBy: actor.name, disapprovedAt: new Date(), disapproveReason: trimmedReason },
      include: { items: true },
    });
    await writeAuditLog(tx, actor, 'SRS_DISAPPROVED', 'MRS', mrsId, { reason: trimmedReason });
    return mrsDto(updated);
  });
}

export async function cancelMRS(mrsId: string, reason: string, userId: string) {
  const actor = await requireAuthenticatedUser(userId);
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error('A cancellation reason is required.');
  if (trimmedReason.length > 2000) throw new Error('Cancellation reason must be 2,000 characters or fewer.');

  const updated = await prisma.$transaction(async tx => {
    const current = await tx.mRS.findUniqueOrThrow({ where: { id: mrsId }, include: { items: true } });
    if (current.status === 'REJECTED') throw new Error('This MRS has already been cancelled.');
    const isSuperAdmin = actor.role === 'SUPER_ADMIN';
    const isRequester = current.createdById === actor.id;
    if (!isSuperAdmin && (!isRequester || current.status !== 'PENDING')) {
      throw new Error('You may cancel only your own pending MRS.');
    }
    if (isSuperAdmin && current.status !== 'PENDING' && current.status !== 'APPROVED') {
      throw new Error('An MRS can only be cancelled before materials are issued.');
    }

    const cancelled = await tx.mRS.update({
      where: { id: mrsId },
      data: { status: 'REJECTED', cancelledBy: actor.name, cancelledAt: new Date(), cancelReason: trimmedReason },
      include: { items: true },
    });
    await writeAuditLog(tx, actor, 'MRS_CANCELLED', 'MRS', mrsId, { reason: trimmedReason });
    return cancelled;
  });
  return mrsDto(updated);
}

export async function issueMRS(mrsId: string, warehouse: Warehouse, userId: string) {
  await requireWarehousePermission(userId, 'mrs:issue', warehouse);
  return prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user?.isActive) throw new Error('Only active users can issue material requisitions.');
    const restrictedWarehouse = warehouseForRole(user.role);
    if (restrictedWarehouse && warehouse !== restrictedWarehouse) {
      throw new Error(`You can only issue from the ${restrictedWarehouse === 'ENGINEERING' ? 'Engineering' : 'Farm'} Warehouse.`);
    }
    const current = await tx.mRS.findUniqueOrThrow({ where: { id: mrsId }, include: { items: true } });
    if (current.status !== 'APPROVED') throw new Error('Only approved material requisitions can be issued.');
    const inventoryItems = current.items
      .filter(item => item.itemId)
      .map(item => ({
        item,
        itemId: item.itemId as string,
        quantity: Number(item.quantityApproved),
      }));

    if (inventoryItems.some(({ quantity }) => !Number.isFinite(quantity) || quantity <= 0)) {
      throw new Error('Every inventory item must have a positive approved quantity before issuance.');
    }

    const requestedByItemId = new Map<string, number>();
    for (const { itemId, quantity } of inventoryItems) {
      requestedByItemId.set(itemId, (requestedByItemId.get(itemId) || 0) + quantity);
    }

    const stockByItemId = new Map<string, { id: string; quantity: number }>();
    for (const [itemId, requestedQuantity] of requestedByItemId) {
      const stock = await tx.warehouseStock.findUnique({ where: { itemId_warehouse: { itemId, warehouse } } });
      if (!stock || Number(stock.quantity) < requestedQuantity) throw new Error(`Insufficient stock for item ${itemId}.`);
      stockByItemId.set(itemId, { id: stock.id, quantity: Number(stock.quantity) });
    }

    let movementCount = 0;
    for (const { item, itemId, quantity } of inventoryItems) {
      const stock = stockByItemId.get(itemId);
      if (!stock) throw new Error(`Stock record not found for item ${itemId}.`);
      const updatedStock = await tx.warehouseStock.update({
        where: { id: stock.id },
        data: { quantity: { decrement: quantity } },
      });
      const movement = await tx.stockMovement.create({
        data: {
          itemId,
          warehouse,
          quantity: -quantity,
          quantityAfter: updatedStock.quantity,
          type: 'ISSUANCE',
          referenceId: current.mrsNumber,
          referenceType: 'MRS',
          createdBy: user.name,
          documentNumber: current.mrsNumber,
          remarks: `Issued for ${current.mrsNumber}`,
        },
      });
      if (!movement.id) throw new Error(`Unable to record stock movement for item ${itemId}.`);
      movementCount += 1;
      await tx.mRSItem.update({ where: { id: item.id }, data: { quantityIssued: quantity } });
    }

    if (movementCount !== inventoryItems.length) {
      throw new Error('Issuance was not completed because stock movement records could not be created.');
    }

    for (const item of current.items.filter(item => !item.itemId)) await tx.mRSItem.update({ where: { id: item.id }, data: { quantityIssued: item.quantityApproved || item.quantityRequested } });
    const updated = await tx.mRS.update({ where: { id: mrsId }, data: { status: 'ISSUED' }, include: { items: true } });
    if (current.workOrderId) {
      const workOrderItems = await tx.workOrderItem.findMany({ where: { workOrderId: current.workOrderId } });
      for (const workOrderItem of workOrderItems) {
        const issuedLines = await tx.mRSItem.aggregate({
          where: { itemId: workOrderItem.itemId, mrs: { is: { workOrderId: current.workOrderId, status: { not: 'REJECTED' } } } },
          _sum: { quantityIssued: true },
        });
        const quantityIssued = Math.min(Number(workOrderItem.quantityNeeded), numberValue(issuedLines._sum.quantityIssued || 0));
        await tx.workOrderItem.update({ where: { id: workOrderItem.id }, data: { quantityIssued } });
      }
    }
    return {
      ...mrsDto(updated),
      issuedAt: new Date().toISOString(),
      issuedBy: user.name,
      issuedWarehouse: warehouse,
    };
  });
}

export async function getWorkOrderFormData(userId: string) {
  await requirePermission(userId, 'work-orders:create');
  const [items, stocks] = await Promise.all([
    prisma.item.findMany({ orderBy: { name: 'asc' } }),
    prisma.warehouseStock.findMany(),
  ]);
  return { items: items.map(itemDto), stocks: stocks.map(stockDto) };
}

export async function createWorkOrder(input: { type: 'MRRF' | 'EPRF'; dateNeeded: string; department: string; machineEquipment: string; areaBuilding: string; specification: string; description: string; priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; requestedBy: string; createdById: string; items: Array<{ itemId: string; quantityNeeded: number }> }) {
  await requirePermission(input.createdById, 'work-orders:create');
  workOrderFormSchema.parse(input);
  return prisma.$transaction(async tx => {
    const woNumber = await allocateDocumentNumber(tx, 'WORK_ORDER');
    const created = await tx.workOrder.create({ data: { woNumber, type: input.type, dateNeeded: new Date(input.dateNeeded), department: input.department.trim(), machineEquipment: input.machineEquipment.trim(), areaBuilding: input.areaBuilding.trim(), specification: input.specification, description: input.description, priority: input.priority, requestedBy: input.requestedBy.trim(), createdById: input.createdById, items: { create: input.items.map(item => ({ itemId: item.itemId, quantityNeeded: item.quantityNeeded })) } }, include: { items: true } });
    return workOrderDto(created);
  });
}

export async function updateWorkOrder(input: { id: string; userId: string; type: 'MRRF' | 'EPRF'; dateNeeded: string; department: string; machineEquipment: string; areaBuilding: string; specification: string; description: string; priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; requestedBy: string; items: Array<{ itemId: string; quantityNeeded: number }> }) {
  const actor = await requirePermission(input.userId, 'work-orders:create');
  workOrderFormSchema.parse(input);
  return prisma.$transaction(async tx => {
    const current = await tx.workOrder.findUnique({
      where: { id: input.id },
      include: { items: true, mrsList: { where: { status: { not: 'REJECTED' } }, include: { items: true } } },
    });
    if (!current) throw new Error('This Job Order no longer exists.');
    const canRework = current.status === 'REJECTED' && Boolean(current.disapprovedBy) && !current.cancelledBy;
    if (current.status !== 'PENDING' && current.status !== 'IN_PROGRESS' && !canRework) {
      throw new Error('Only pending, in-progress, or disapproved Job Orders can be edited. Approved, completed, and cancelled orders are locked.');
    }

    const requestedByItem = new Map<string, number>();
    const issuedByItem = new Map<string, number>();
    for (const mrsItem of current.mrsList.flatMap(mrs => mrs.items)) {
      if (!mrsItem.itemId) continue;
      requestedByItem.set(mrsItem.itemId, (requestedByItem.get(mrsItem.itemId) || 0) + Number(mrsItem.quantityRequested));
      issuedByItem.set(mrsItem.itemId, (issuedByItem.get(mrsItem.itemId) || 0) + Number(mrsItem.quantityIssued));
    }
    const updatedItemIds = new Set(input.items.map(item => item.itemId));
    for (const [itemId, requested] of requestedByItem) {
      if (requested > 0 && !updatedItemIds.has(itemId)) {
        throw new Error('A material with an existing requisition cannot be removed from the Job Order. Keep the line and adjust only after its requisition is resolved.');
      }
    }
    for (const item of input.items) {
      const minimum = Math.max(requestedByItem.get(item.itemId) || 0, issuedByItem.get(item.itemId) || 0);
      if (item.quantityNeeded < minimum) {
        throw new Error('A material quantity cannot be reduced below quantities already requisitioned or issued.');
      }
    }

    const approvedMRSIds = current.mrsList.filter(mrs => mrs.status === 'APPROVED').map(mrs => mrs.id);
    if (approvedMRSIds.length > 0) {
      await tx.mRSItem.updateMany({
        where: { mrsId: { in: approvedMRSIds } },
        data: { quantityApproved: 0 },
      });
      await tx.mRS.updateMany({
        where: { id: { in: approvedMRSIds }, status: 'APPROVED' },
        data: { status: 'PENDING' },
      });
    }
    await tx.workOrderItem.deleteMany({ where: { workOrderId: current.id } });
    const updated = await tx.workOrder.update({
      where: { id: current.id },
      data: {
        type: input.type,
        dateNeeded: new Date(input.dateNeeded),
        department: input.department.trim(),
        machineEquipment: input.machineEquipment.trim(),
        areaBuilding: input.areaBuilding.trim(),
        specification: input.specification,
        description: input.description,
        priority: input.priority,
        requestedBy: input.requestedBy.trim(),
        status: 'PENDING',
        editedBy: actor.name,
        editedAt: new Date(),
        disapprovedBy: null,
        disapprovedAt: null,
        disapproveReason: null,
        cancelledBy: null,
        cancelledAt: null,
        cancelReason: null,
        items: {
          create: input.items.map(item => ({
            itemId: item.itemId,
            quantityNeeded: item.quantityNeeded,
            quantityIssued: issuedByItem.get(item.itemId) || 0,
          })),
        },
      },
      include: {
        items: { include: { item: { select: { id: true, code: true, name: true, unit: true } } } },
        mrsList: {
          include: { items: { select: { id: true, itemId: true, quantityRequested: true, quantityIssued: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    await writeAuditLog(tx, actor, 'JOB_ORDER_UPDATED', 'WORK_ORDER', current.id, { number: current.woNumber });
    return workOrderDto(updated);
  });
}

export async function updateWorkOrderStatus(id: string, status: WorkOrder['status'], userId: string) {
  await requirePermission(userId, 'work-orders:approve');
  return prisma.$transaction(async tx => {
    const workOrder = await tx.workOrder.findUniqueOrThrow({
      where: { id },
      include: { items: true, mrsList: { where: { status: { not: 'REJECTED' } }, include: { items: true } } },
    });
    if (workOrder.status === 'REJECTED') throw new Error(workOrder.disapprovedBy ? 'A disapproved Job Order must be reworked before it can proceed.' : 'A cancelled Job Order cannot be updated.');
    if (status === 'REJECTED') throw new Error('Use the cancellation action to cancel a Job Order.');
    if (workOrder.status === 'COMPLETED') throw new Error('A completed Job Order cannot be updated.');
    if (status === 'APPROVED' && workOrder.status !== 'PENDING') throw new Error('Only pending Job Orders can be approved.');
    if (status === 'IN_PROGRESS' && workOrder.status !== 'APPROVED') throw new Error('Only approved Job Orders can be started.');
    if (status === 'COMPLETED' && workOrder.status !== 'IN_PROGRESS') throw new Error('Only in-progress Job Orders can be completed.');
    if (status === 'PENDING') throw new Error('Use the edit action to return a Job Order to pending approval.');
    if (status === 'APPROVED' && workOrder.type === 'MRRF') {
      await requirePermission(userId, 'work-orders:mrrf:approve');
    }
    if (status === 'IN_PROGRESS' || status === 'COMPLETED') {
      const notFullyIssued = workOrder.items.some(workOrderItem => {
        const quantityIssued = workOrder.mrsList.flatMap(mrs => mrs.items)
          .filter(item => item.itemId === workOrderItem.itemId)
          .reduce((total, item) => total + Number(item.quantityIssued), 0);
        return quantityIssued < Number(workOrderItem.quantityNeeded);
      });
      if (notFullyIssued) throw new Error('All required Job Order materials must be fully issued before work can start or be completed.');
    }
    return workOrderDto(await tx.workOrder.update({
      where: { id },
      data: { status },
      include: {
        items: { include: { item: { select: { id: true, code: true, name: true, unit: true } } } },
        mrsList: {
          include: { items: { select: { id: true, itemId: true, quantityRequested: true, quantityIssued: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    }));
  });
}

export async function disapproveWorkOrder(id: string, reason: string, userId: string) {
  const actor = await requirePermission(userId, 'work-orders:approve');
  if (!canDisapproveRequest(actor.role, 'work-orders:approve', actor.permissions)) {
    throw new Error('You are not authorized to disapprove Job Orders.');
  }
  const trimmedReason = disapprovalReasonSchema.parse(reason);
  return prisma.$transaction(async tx => {
    const current = await tx.workOrder.findUniqueOrThrow({ where: { id } });
    if (current.status !== 'PENDING') throw new Error('Only pending Job Orders can be disapproved.');
    if (current.type === 'MRRF') await requirePermission(userId, 'work-orders:mrrf:approve');
    const updated = await tx.workOrder.update({
      where: { id },
      data: { status: 'REJECTED', disapprovedBy: actor.name, disapprovedAt: new Date(), disapproveReason: trimmedReason },
      include: {
        items: { include: { item: { select: { id: true, code: true, name: true, unit: true } } } },
        mrsList: {
          include: { items: { select: { id: true, itemId: true, quantityRequested: true, quantityIssued: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    await writeAuditLog(tx, actor, 'JOB_ORDER_DISAPPROVED', 'WORK_ORDER', id, { reason: trimmedReason });
    return workOrderDto(updated);
  });
}

export async function cancelWorkOrder(id: string, reason: string, userId: string) {
  const actor = await requireAuthenticatedUser(userId);
  if (actor.role !== 'ENGINEERING_SUPERVISOR' && actor.role !== 'SUPER_ADMIN') {
    throw new Error('Only Engineering Supervisors and Super Admin can cancel Job Orders.');
  }
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error('A cancellation reason is required.');
  if (trimmedReason.length > 2000) throw new Error('Cancellation reason must be 2,000 characters or fewer.');

  const cancelled = await prisma.$transaction(async tx => {
    const current = await tx.workOrder.findUniqueOrThrow({ where: { id }, include: { items: { include: { item: true } } } });
    if (current.status === 'APPROVED') throw new Error('Approved Job Orders cannot be cancelled.');
    if (current.status === 'REJECTED') throw new Error('This Job Order has already been cancelled.');
    const updated = await tx.workOrder.update({
      where: { id },
      data: { status: 'REJECTED', cancelledBy: actor.name, cancelledAt: new Date(), cancelReason: trimmedReason },
      include: { items: { include: { item: true } } },
    });
    await writeAuditLog(tx, actor, 'JOB_ORDER_CANCELLED', 'WORK_ORDER', id, { reason: trimmedReason });
    return updated;
  });
  return workOrderDto(cancelled);
}

const movementDto = (value: any): StockMovement => ({ ...value, quantity: numberValue(value.quantity), quantityAfter: numberValue(value.quantityAfter), createdAt: value.createdAt.toISOString() });

export async function getMovementsData(filters: { from?: string; to?: string; warehouse?: Warehouse | 'ALL'; type?: StockMovement['type'] | 'ALL'; itemId?: string } | undefined, userId: string) {
  await requirePermission(userId, 'movements:view');
  const where = {
    ...(filters?.warehouse && filters.warehouse !== 'ALL' ? { warehouse: filters.warehouse } : {}),
    ...(filters?.type && filters.type !== 'ALL' ? { type: filters.type } : {}),
    ...(filters?.itemId && filters.itemId !== 'ALL' ? { itemId: filters.itemId } : {}),
    ...(filters?.from || filters?.to ? { createdAt: { ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00`) } : {}), ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59.999`) } : {}) } } : {}),
  };
  const [movements, items] = await Promise.all([prisma.stockMovement.findMany({ where, orderBy: { createdAt: 'desc' } }), prisma.item.findMany({ orderBy: { name: 'asc' } })]);
  return { movements: movements.map(movementDto), items: items.map(itemDto) };
}

export async function getItemMovementHistory(itemId: string, pageNumber: number, userId: string) {
  await requirePermission(userId, 'inventory:view');
  const page = normalizedPage(pageNumber);
  const pageSize = 5;
  const [values, total] = await Promise.all([
    prisma.stockMovement.findMany({ where: { itemId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.stockMovement.count({ where: { itemId } }),
  ]);
  return { rows: values.map(movementDto), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getReceivingData(userId: string) {
  await requirePermission(userId, 'receiving:view');
  const [receivings, items] = await Promise.all([prisma.receiving.findMany({ include: { items: { include: { item: { include: { stocks: true } } } }, attachments: { select: { id: true, type: true, fileName: true, mimeType: true } } }, orderBy: { receivedDate: 'desc' } }), prisma.item.findMany({ orderBy: { name: 'asc' } })]);
  return { receivings: receivings.map((value: any): Receiving => ({ id: value.id, rrNumber: value.rrNumber, drNumber: value.drNumber, invoiceNumber: value.invoiceNumber, warehouse: value.warehouse, receivedBy: value.receivedBy, receivedDate: dateOnly(value.receivedDate), drFileUrl: value.drFileUrl || undefined, invoiceFileUrl: value.invoiceFileUrl || undefined, attachments: value.attachments, items: value.items?.map((item: any) => ({ id: item.id, receivingId: item.receivingId, itemId: item.itemId, qtyReceived: numberValue(item.qtyReceived), unitCost: numberValue(item.unitCost), category: item.item.category, reorderLevel: numberValue(item.item.stocks.find((stock: any) => stock.warehouse === value.warehouse)?.minStockLevel ?? 0), item: item.item ? { code: item.item.code, name: item.item.name, unit: item.item.unit } : undefined })) })) as Receiving[], items: items.map(itemDto) };
}

type ReceivingUpload = { fileName: string; mimeType: string; dataBase64: string };
const receivingMimeTypes = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const maxReceivingFileBytes = 5 * 1024 * 1024;

function decodeReceivingUpload(upload: ReceivingUpload | undefined) {
  if (!upload) return undefined;
  if (!receivingMimeTypes.has(upload.mimeType)) throw new Error('Receiving attachments must be PDF, PNG, or JPG files.');
  if (!upload.fileName.trim() || upload.fileName.length > 255) throw new Error('Attachment file name is invalid.');
  const encoded = upload.dataBase64.replace(/^data:[^,]+,/, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('Attachment data is invalid.');
  const data = Buffer.from(encoded, 'base64');
  if (data.length === 0 || data.length > maxReceivingFileBytes) throw new Error('Attachments must be non-empty and no larger than 5 MB.');
  const validContent = upload.mimeType === 'application/pdf'
    ? data.subarray(0, 5).toString('ascii') === '%PDF-'
    : upload.mimeType === 'image/png'
      ? data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (!validContent) throw new Error('Attachment contents do not match the selected PDF, PNG, or JPG file type.');
  return { ...upload, data };
}

export async function getReceivingAttachment(input: { receivingId: string; type: 'DELIVERY_RECEIPT' | 'INVOICE'; userId: string }) {
  await requirePermission(input.userId, 'receiving:view');
  const attachment = await prisma.receivingAttachment.findUnique({
    where: { receivingId_type: { receivingId: input.receivingId, type: input.type } },
    select: { fileName: true, mimeType: true, data: true },
  });
  if (!attachment) throw new Error('This receiving report has no stored attachment of that type.');
  return { fileName: attachment.fileName, mimeType: attachment.mimeType, dataBase64: Buffer.from(attachment.data).toString('base64') };
}

export async function uploadReceivingAttachment(input: {
  receivingId: string;
  type: 'DELIVERY_RECEIPT' | 'INVOICE';
  userId: string;
  file: ReceivingUpload;
}) {
  await requirePermission(input.userId, 'receiving:attachments:upload');
  const upload = decodeReceivingUpload(input.file);
  if (!upload) throw new Error('Choose a file to upload.');

  return prisma.$transaction(async tx => {
    const receiving = await tx.receiving.findUnique({
      where: { id: input.receivingId },
      select: { id: true },
    });
    if (!receiving) throw new Error('Receiving Report could not be found.');

    const existing = await tx.receivingAttachment.findUnique({
      where: { receivingId_type: { receivingId: input.receivingId, type: input.type } },
      select: { id: true },
    });
    if (existing) throw new Error('This document is already uploaded.');

    const attachment = await tx.receivingAttachment.create({
      data: {
        receivingId: input.receivingId,
        type: input.type,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        data: upload.data,
      },
      select: { id: true, type: true, fileName: true, mimeType: true },
    });

    await tx.receiving.update({
      where: { id: input.receivingId },
      data: input.type === 'DELIVERY_RECEIPT'
        ? { drFileUrl: upload.fileName }
        : { invoiceFileUrl: upload.fileName },
    });

    return attachment;
  });
}

export async function createReceiving(input: { drNumber: string; invoiceNumber: string; warehouse: Warehouse; receivedBy: string; userId: string; items: Array<{ itemCode: string; itemName: string; category: string; quantity: number; unit: string; reorderLevel: number }>; drFile?: ReceivingUpload; invoiceFile?: ReceivingUpload }) {
  const actor = await requireWarehousePermission(input.userId, 'receiving:create', input.warehouse);
  return prisma.$transaction(async tx => {
    if (!input.drNumber.trim()) throw new Error('Delivery receipt number is required.');
    if (!input.invoiceNumber.trim()) throw new Error('Invoice number is required.');
    if (!input.items.length) throw new Error('Add at least one item to the receiving report.');
    const drFile = decodeReceivingUpload(input.drFile);
    const invoiceFile = decodeReceivingUpload(input.invoiceFile);

    const warehouse = input.warehouse;
    const rrNumber = await allocateDocumentNumber(tx, 'RECEIVING');
    const receiving = await tx.receiving.create({
      data: {
        rrNumber,
        drNumber: input.drNumber.trim(),
        invoiceNumber: input.invoiceNumber.trim(),
        warehouse,
        receivedBy: actor.name,
        drFileUrl: drFile?.fileName,
        invoiceFileUrl: invoiceFile?.fileName,
        attachments: {
          create: [
            ...(drFile ? [{ type: 'DELIVERY_RECEIPT' as const, fileName: drFile.fileName, mimeType: drFile.mimeType, data: drFile.data }] : []),
            ...(invoiceFile ? [{ type: 'INVOICE' as const, fileName: invoiceFile.fileName, mimeType: invoiceFile.mimeType, data: invoiceFile.data }] : []),
          ],
        },
      },
      include: { items: true },
    });

    for (const rawItem of input.items) {
      const itemCode = rawItem.itemCode.trim();
      const itemName = rawItem.itemName.trim();
      const category = rawItem.category.trim();
      const unit = rawItem.unit.trim();
      const quantity = Number(rawItem.quantity);
      const reorderLevel = Number(rawItem.reorderLevel);

      if (!itemCode) throw new Error('Item code is required for every receiving entry.');
      if (!itemName) throw new Error('Item name is required for every receiving entry.');
      if (!category) throw new Error(`Category is required for item ${itemCode}.`);
      if (!unit) throw new Error(`Unit is required for item ${itemCode}.`);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Quantity for item ${itemCode} must be greater than zero.`);
      if (!Number.isFinite(reorderLevel) || reorderLevel < 0) throw new Error(`Reorder level for item ${itemCode} must be zero or greater.`);

      const item = await tx.item.upsert({
        where: { code: itemCode },
        update: {
          name: itemName,
          category,
          unit,
        },
        create: {
          code: itemCode,
          name: itemName,
          category,
          unit,
        },
      });

      const stock = await tx.warehouseStock.upsert({
        where: { itemId_warehouse: { itemId: item.id, warehouse } },
        update: {
          quantity: { increment: quantity },
          minStockLevel: reorderLevel,
        },
        create: {
          itemId: item.id,
          warehouse,
          quantity,
          minStockLevel: reorderLevel,
        },
      });

      await tx.receivingItem.create({
        data: {
          receivingId: receiving.id,
          itemId: item.id,
          qtyReceived: quantity,
          unitCost: 0,
        },
      });

      await tx.stockMovement.create({
        data: {
          itemId: item.id,
          warehouse,
          quantity,
          quantityAfter: stock.quantity,
          type: 'RECEIVING',
          referenceId: receiving.rrNumber,
          referenceType: 'RECEIVING',
          createdBy: actor.name,
          documentNumber: input.drNumber.trim(),
          remarks: `Received ${itemName} under ${receiving.rrNumber}`,
        },
      });
    }

    return receiving.rrNumber;
  });
}

export async function issueStock(input: { itemId: string; warehouse: Warehouse; quantity: number; referenceId: string; referenceType: 'MRS' | 'WORK_ORDER'; createdBy: string; userId: string; remarks?: string }) {
  const actor = await requireWarehousePermission(input.userId, 'inventory:issue', input.warehouse);
  return prisma.$transaction(async tx => {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error('Issuance quantity must be greater than zero.');
    const current = await tx.warehouseStock.findUnique({ where: { itemId_warehouse: { itemId: input.itemId, warehouse: input.warehouse } } });
    if (!current || Number(current.quantity) < input.quantity) throw new Error('Insufficient stock for this warehouse.');
    const stock = await tx.warehouseStock.update({ where: { id: current.id }, data: { quantity: { decrement: input.quantity } } });
    await tx.stockMovement.create({ data: { itemId: input.itemId, warehouse: input.warehouse, quantity: -input.quantity, quantityAfter: stock.quantity, type: 'ISSUANCE', referenceId: input.referenceId, referenceType: input.referenceType, createdBy: actor.name, remarks: input.remarks } });
    return stockDto(stock);
  });
}

export async function createStockTransfer(input: {
  transferNo: string; mrsNo?: string; prPoNo?: string; mirrNo?: string;
  transferredFrom: Warehouse; transferredTo: Warehouse; dateTransferred: string;
  modeOfTransport?: string;
  performedBy: string; userId: string;
  items: Array<{ itemId: string; quantity: number; unit: string }>;
}) {
  const actor = await requireWarehousePermission(input.userId, 'inventory:transfer', input.transferredFrom);
  return prisma.$transaction(async tx => {
    if (!input.transferNo.trim()) throw new Error('Transfer number is required.');
    if (input.transferredFrom === input.transferredTo) throw new Error('Source and destination warehouses must be different.');
    if (!input.items.length) throw new Error('Add at least one material to the transfer.');
    const quantityByItem = new Map<string, number>();
    for (const item of input.items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error('Transfer quantities must be greater than zero.');
      if (!item.unit.trim()) throw new Error('A unit is required for every transfer item.');
      quantityByItem.set(item.itemId, (quantityByItem.get(item.itemId) || 0) + item.quantity);
    }
    const sourceStocks = new Map<string, { id: string; quantity: number }>();
    for (const [itemId, quantity] of quantityByItem) {
      const stock = await tx.warehouseStock.findUnique({ where: { itemId_warehouse: { itemId, warehouse: input.transferredFrom } } });
      if (!stock || Number(stock.quantity) < quantity) {
        throw new Error(`Insufficient source stock for item ${itemId}. Available: ${Number(stock?.quantity || 0)}; requested: ${quantity}.`);
      }
      sourceStocks.set(itemId, { id: stock.id, quantity: Number(stock.quantity) });
    }
    const transfer = await tx.stockTransfer.create({ data: {
      transferNo: input.transferNo.trim(), mrsNo: input.mrsNo || null, prPoNo: input.prPoNo || null, mirrNo: input.mirrNo || null,
      transferredFrom: input.transferredFrom, transferredTo: input.transferredTo, dateTransferred: new Date(input.dateTransferred),
      modeOfTransport: input.modeOfTransport || null,
      performedBy: actor.name,
      items: { create: input.items.map(item => ({ itemId: item.itemId, quantity: item.quantity, unit: item.unit })) },
    } });
    for (const [itemId, quantity] of quantityByItem) {
      const source = sourceStocks.get(itemId);
      if (!source) throw new Error(`Source stock record not found for item ${itemId}.`);
      const sourceAfter = await tx.warehouseStock.update({ where: { id: source.id }, data: { quantity: { decrement: quantity } } });
      const destination = await tx.warehouseStock.upsert({ where: { itemId_warehouse: { itemId, warehouse: input.transferredTo } }, update: { quantity: { increment: quantity } }, create: { itemId, warehouse: input.transferredTo, quantity, minStockLevel: 5 } });
      await tx.stockMovement.createMany({ data: [
        { itemId, warehouse: input.transferredFrom, quantity: -quantity, quantityAfter: sourceAfter.quantity, type: 'TRANSFER', referenceId: transfer.transferNo, referenceType: 'TRANSFER', createdBy: actor.name, documentNumber: transfer.transferNo, remarks: `Transferred to ${input.transferredTo}` },
        { itemId, warehouse: input.transferredTo, quantity, quantityAfter: destination.quantity, type: 'TRANSFER', referenceId: transfer.transferNo, referenceType: 'TRANSFER', createdBy: actor.name, documentNumber: transfer.transferNo, remarks: `Transferred from ${input.transferredFrom}` },
      ] });
    }
    return transfer.transferNo;
  });
}

export async function getUsersData(userId: string) { await requirePermission(userId, 'users:view'); return (await prisma.user.findMany({ orderBy: { name: 'asc' } })).map(userDto); }

const listPageSize = 20;
type ListPageInput = { page?: number; search?: string };
const normalizedPage = (page?: number) => Number.isInteger(page) && page! > 0 ? page! : 1;
const pageResult = <T,>(rows: T[], total: number, page: number) => ({
  rows,
  page,
  pageSize: listPageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / listPageSize)),
});

export async function getWorkOrderListPage(input: ListPageInput, userId: string) {
  await requirePermission(userId, 'work-orders:view');
  const page = normalizedPage(input.page);
  const search = input.search?.trim();
  const where: Prisma.WorkOrderWhereInput = search ? {
    OR: [
      { woNumber: { contains: search } },
      { requestedBy: { contains: search } },
      { department: { contains: search } },
    ],
  } : {};
  const [values, total] = await Promise.all([
    prisma.workOrder.findMany({
      where,
      include: {
        items: {
          include: { item: { select: { id: true, code: true, name: true, unit: true } } },
        },
        mrsList: {
          include: {
            items: { select: { id: true, itemId: true, quantityRequested: true, quantityIssued: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * listPageSize,
      take: listPageSize,
    }),
    prisma.workOrder.count({ where }),
  ]);
  const rows = values.map(value => ({
    ...workOrderDto(value),
    mrsList: value.mrsList.map(mrs => ({
      id: mrs.id,
      mrsNumber: mrs.mrsNumber,
      status: mrs.status,
      dateRequested: dateOnly(mrs.dateRequested),
      createdAt: dateOnly(mrs.createdAt),
      itemCount: mrs.items.length,
      disapprovedBy: mrs.disapprovedBy || undefined,
      items: mrs.items.map(item => ({ id: item.id, itemId: item.itemId || undefined, quantityRequested: numberValue(item.quantityRequested), quantityIssued: numberValue(item.quantityIssued) })),
    })),
  }));
  return pageResult(rows, total, page);
}

export async function getMRSListPage(input: ListPageInput, userId: string) {
  await requirePermission(userId, 'mrs:view');
  const page = normalizedPage(input.page);
  const search = input.search?.trim();
  const where: Prisma.MRSWhereInput = search ? {
    OR: [
      { mrsNumber: { contains: search } },
      { requestedBy: { contains: search } },
      { department: { contains: search } },
    ],
  } : {};
  const [values, total] = await Promise.all([
    prisma.mRS.findMany({ where, include: { items: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * listPageSize, take: listPageSize }),
    prisma.mRS.count({ where }),
  ]);
  return pageResult(values.map(mrsDto), total, page);
}

export async function getInventoryListPage(input: ListPageInput & { warehouse?: Warehouse | 'ALL' }, userId: string) {
  await requirePermission(userId, 'inventory:view');
  const page = normalizedPage(input.page);
  const search = input.search?.trim();
  const where: Prisma.WarehouseStockWhereInput = {
    ...(input.warehouse && input.warehouse !== 'ALL' ? { warehouse: input.warehouse } : {}),
    ...(search ? { item: { OR: [{ name: { contains: search } }, { code: { contains: search } }, { category: { contains: search } }] } } : {}),
  };
  const [values, total] = await Promise.all([
    prisma.warehouseStock.findMany({ where, include: { item: true }, orderBy: [{ item: { name: 'asc' } }, { warehouse: 'asc' }], skip: (page - 1) * listPageSize, take: listPageSize }),
    prisma.warehouseStock.count({ where }),
  ]);
  const rows = values.map(value => ({ item: itemDto(value.item), stock: stockDto(value) }));
  return pageResult(rows, total, page);
}

type MovementListInput = ListPageInput & { from?: string; to?: string; warehouse?: Warehouse | 'ALL'; type?: StockMovement['type'] | 'ALL'; itemId?: string };
export async function getMovementListPage(input: MovementListInput, userId: string) {
  await requirePermission(userId, 'movements:view');
  const page = normalizedPage(input.page);
  const search = input.search?.trim();
  const where: Prisma.StockMovementWhereInput = {
    ...(input.warehouse && input.warehouse !== 'ALL' ? { warehouse: input.warehouse } : {}),
    ...(input.type && input.type !== 'ALL' ? { type: input.type } : {}),
    ...(input.itemId && input.itemId !== 'ALL' ? { itemId: input.itemId } : {}),
    ...(search ? { item: { OR: [{ name: { contains: search } }, { code: { contains: search } }] } } : {}),
    ...(input.from || input.to ? { createdAt: { ...(input.from ? { gte: new Date(`${input.from}T00:00:00`) } : {}), ...(input.to ? { lte: new Date(`${input.to}T23:59:59.999`) } : {}) } } : {}),
  };
  const [values, total, items] = await Promise.all([
    prisma.stockMovement.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * listPageSize, take: listPageSize }),
    prisma.stockMovement.count({ where }),
    prisma.item.findMany({ orderBy: { name: 'asc' } }),
  ]);
  return { ...pageResult(values.map(movementDto), total, page), items: items.map(itemDto) };
}

export async function getReceivingListPage(input: ListPageInput, userId: string) {
  await requirePermission(userId, 'receiving:view');
  const page = normalizedPage(input.page);
  const search = input.search?.trim();
  const where: Prisma.ReceivingWhereInput = search ? {
    OR: [
      { rrNumber: { contains: search } },
      { drNumber: { contains: search } },
      { invoiceNumber: { contains: search } },
    ],
  } : {};
  const [values, total] = await Promise.all([
    prisma.receiving.findMany({
      where,
      include: { items: { include: { item: { include: { stocks: true } } } }, attachments: { select: { id: true, type: true, fileName: true, mimeType: true } } },
      orderBy: { receivedDate: 'desc' },
      skip: (page - 1) * listPageSize,
      take: listPageSize,
    }),
    prisma.receiving.count({ where }),
  ]);
  const rows = values.map((value: any): Receiving => ({
    id: value.id,
    rrNumber: value.rrNumber,
    drNumber: value.drNumber,
    invoiceNumber: value.invoiceNumber,
    warehouse: value.warehouse,
    receivedBy: value.receivedBy,
    receivedDate: dateOnly(value.receivedDate),
    drFileUrl: value.drFileUrl || undefined,
    invoiceFileUrl: value.invoiceFileUrl || undefined,
    attachments: value.attachments,
    items: value.items?.map((item: any) => ({
      id: item.id,
      receivingId: item.receivingId,
      itemId: item.itemId,
      qtyReceived: numberValue(item.qtyReceived),
      unitCost: numberValue(item.unitCost),
      category: item.item.category,
      reorderLevel: numberValue(item.item.stocks.find((stock: any) => stock.warehouse === value.warehouse)?.minStockLevel ?? 0),
      item: { code: item.item.code, name: item.item.name, unit: item.item.unit },
    })),
  }));
  return { ...pageResult(rows, total, page), items: (await prisma.item.findMany({ orderBy: { name: 'asc' } })).map(itemDto) };
}

type UserListInput = ListPageInput & { role?: User['role'] | 'ALL'; status?: 'ALL' | 'ACTIVE' | 'INACTIVE' };
export async function getUserListPage(input: UserListInput, userId: string) {
  await requirePermission(userId, 'users:view');
  const page = normalizedPage(input.page);
  const search = input.search?.trim();
  const where: Prisma.UserWhereInput = {
    ...(input.role && input.role !== 'ALL' ? { role: input.role } : {}),
    ...(input.status === 'ACTIVE' ? { isActive: true } : input.status === 'INACTIVE' ? { isActive: false } : {}),
    ...(search ? { OR: [{ name: { contains: search } }, { email: { contains: search } }, { employeeId: { contains: search } }, { department: { contains: search } }] } : {}),
  };
  const [values, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * listPageSize, take: listPageSize }),
    prisma.user.count({ where }),
  ]);
  return pageResult(values.map(userDto), total, page);
}
export async function createUser(input: { name: string; email: string; password: string; employeeId?: string; role: User['role']; department?: string; isActive: boolean; actorId: string; confirmPassword?: string }) {
  const actor = await requirePermission(input.actorId, 'users:create');
  if (input.role === 'SUPER_ADMIN') await requirePermission(input.actorId, 'users:create-super-admin');
  if (!canManageUser(actor.role, input.role)) throw new Error('Only Super Admin can create Super Admin accounts.');
  const { confirmPassword: _confirmPassword, actorId: _actorId, ...userData } = input;
  const created = await prisma.$transaction(async tx => {
    const user = await tx.user.create({ data: { ...userData, password: await bcrypt.hash(userData.password, 12) } });
    await writeAuditLog(tx, actor, 'USER_CREATED', 'USER', user.id, { role: user.role, isActive: user.isActive });
    return user;
  });
  return userDto(created);
}
export async function updateUser(id: string, input: { name: string; email: string; password?: string; employeeId?: string; role: User['role']; department?: string; isActive: boolean; actorId: string; confirmPassword?: string }) {
  const actor = await requirePermission(input.actorId, 'users:update'); const target = await prisma.user.findUnique({ where: { id }, select: { role: true } }); if (!target || !canManageUser(actor.role, target.role) || !canManageUser(actor.role, input.role) || (target.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN')) throw new Error('Only Super Admin can modify Super Admin accounts.'); if (target.role === 'SUPER_ADMIN' && !input.isActive) throw new Error('Super Admin accounts cannot be deactivated.');
  const { confirmPassword: _confirmPassword, actorId: _actorId, ...userData } = input;
  const updated = await prisma.$transaction(async tx => {
    const user = await tx.user.update({ where: { id }, data: { name: userData.name, email: userData.email, employeeId: userData.employeeId, role: userData.role, department: userData.department, isActive: userData.isActive, password: userData.password ? await bcrypt.hash(userData.password, 12) : undefined, sessionVersion: userData.password || target.role !== userData.role ? { increment: 1 } : undefined } });
    await writeAuditLog(tx, actor, 'USER_UPDATED', 'USER', user.id, { role: user.role, isActive: user.isActive, passwordChanged: Boolean(userData.password) });
    return user;
  });
  return userDto(updated);
}
export async function setUserActive(id: string, isActive: boolean, actorId: string) {
  const actor = await requirePermission(actorId, 'users:deactivate'); const target = await prisma.user.findUnique({ where: { id }, select: { role: true } }); if (!target || !canManageUser(actor.role, target.role) || (target.role === 'SUPER_ADMIN' && !isActive)) throw new Error('Super Admin accounts cannot be deactivated by Administrators.');
  const updated = await prisma.$transaction(async tx => {
    const user = await tx.user.update({ where: { id }, data: { isActive, sessionVersion: { increment: 1 } } });
    await writeAuditLog(tx, actor, isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', 'USER', user.id, { isActive });
    return user;
  });
  return userDto(updated);
}
