'use server';

import { requirePermission } from '@/lib/rbac-server';
import type { ReportFilters, ReportKey, ReportRow } from '@/lib/reports';
import { prisma } from '@/src/lib/prisma';
import { Prisma, type Warehouse } from '@prisma/client';

const PAGE_SIZE = 20;
const warehouses = ['ALL', 'FARM', 'ENGINEERING'] as const;
const movementTypes = ['ALL', 'RECEIVING', 'ISSUANCE', 'TRANSFER', 'RESTOCK', 'ADJUSTMENT'] as const;
const workOrderStatuses = ['ALL', 'PENDING', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
const mrsStatuses = ['ALL', 'PENDING', 'APPROVED', 'ISSUED', 'FULFILLED', 'REJECTED'] as const;
const requestTypes = ['ALL', 'MRRF', 'EPRF'] as const;
const reportKeySet = new Set<string>([
  'stock-inventory',
  'low-stock',
  'stock-movements',
  'work-orders',
  'mrs',
  'issuance',
  'receiving',
  'stock-transfers',
]);

function isOneOf<T extends readonly string[]>(value: string | undefined, options: T): value is T[number] {
  return value !== undefined && options.some(option => option === value);
}

function parseDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Report dates must use YYYY-MM-DD format.');
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  if (Number.isNaN(date.getTime())) throw new Error('A report date is invalid.');
  return date;
}

function dateRange(filters: ReportFilters) {
  const from = parseDate(filters.from);
  const to = parseDate(filters.to, true);
  if (from && to && from > to) throw new Error('The start date must be on or before the end date.');
  return from || to ? { gte: from, lte: to } : undefined;
}

function warehouseFilter(filters: ReportFilters): Warehouse | undefined {
  if (!filters.warehouse || filters.warehouse === 'ALL') return undefined;
  if (filters.warehouse === 'FARM' || filters.warehouse === 'ENGINEERING') return filters.warehouse;
  throw new Error('Select a valid warehouse filter.');
}

const n = (value: unknown) => Number(value);
const iso = (value: Date) => value.toISOString();

export async function getReportData(
  report: ReportKey,
  filters: ReportFilters,
  userId: string,
  page = 1,
): Promise<{ rows: ReportRow[]; departments: string[]; totalRows: number }> {
  if (!reportKeySet.has(report)) throw new Error('Unknown report.');
  if (!Number.isInteger(page) || page < 1) throw new Error('Select a valid report page.');
  await requirePermission(userId, 'reports:view');

  const warehouse = warehouseFilter(filters);
  const dates = dateRange(filters);
  const departments: string[] = [];
  const skip = (page - 1) * PAGE_SIZE;

  switch (report) {
    case 'stock-inventory':
    case 'low-stock': {
      if (report === 'stock-inventory') {
        const locations: Warehouse[] = warehouse ? [warehouse] : ['FARM', 'ENGINEERING'];
        const sourcePageSize = Math.max(1, Math.floor(PAGE_SIZE / locations.length));
        const [items, totalItems] = await Promise.all([
          prisma.item.findMany({
            include: { stocks: { where: warehouse ? { warehouse } : undefined } },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            skip: Math.floor((page - 1) * PAGE_SIZE / locations.length),
            take: sourcePageSize,
          }),
          prisma.item.count(),
        ]);
        return {
          rows: items.flatMap(item => locations.map(location => {
            const stock = item.stocks.find(value => value.warehouse === location);
            return {
              itemCode: item.code,
              name: item.name,
              category: item.category,
              quantity: stock ? n(stock.quantity) : 0,
              unit: item.unit,
              reorderLevel: stock ? n(stock.minStockLevel) : 0,
              location: location === 'FARM' ? 'Farm Warehouse' : 'Engineering Warehouse',
            };
          })),
          departments,
          totalRows: totalItems * locations.length,
        };
      }

      const lowStockWhere = warehouse
        ? Prisma.sql`ws."quantity" <= ws."minStockLevel" AND ws."warehouse" = CAST(${warehouse} AS "Warehouse")`
        : Prisma.sql`ws."quantity" <= ws."minStockLevel"`;
      const [relevantStocks, countResult] = await Promise.all([
        prisma.$queryRaw<Array<{
          code: string;
          name: string;
          category: string;
          unit: string;
          quantity: unknown;
          minStockLevel: unknown;
          warehouse: Warehouse;
        }>>(Prisma.sql`
          SELECT i.code, i.name, i.category, i.unit, ws."quantity", ws."minStockLevel", ws."warehouse"
          FROM "WarehouseStock" AS ws
          INNER JOIN "Item" AS i ON i.id = ws."itemId"
          WHERE ${lowStockWhere}
          ORDER BY i.name ASC, i.id ASC, ws."warehouse" ASC
          LIMIT ${PAGE_SIZE} OFFSET ${skip}
        `),
        prisma.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
          SELECT COUNT(*) AS total
          FROM "WarehouseStock" AS ws
          WHERE ${lowStockWhere}
        `),
      ]);
      return {
        rows: relevantStocks.map(stock => ({
          itemCode: stock.code,
          name: stock.name,
          category: stock.category,
          quantity: n(stock.quantity),
          unit: stock.unit,
          reorderLevel: n(stock.minStockLevel),
          location: stock.warehouse === 'FARM' ? 'Farm Warehouse' : 'Engineering Warehouse',
        })),
        departments,
        totalRows: n(countResult[0]?.total ?? 0),
      };
    }

    case 'stock-movements': {
      if (filters.movementType && !isOneOf(filters.movementType, movementTypes)) throw new Error('Select a valid movement type.');
      const where = {
        ...(warehouse ? { warehouse } : {}),
        ...(filters.movementType && filters.movementType !== 'ALL' ? { type: filters.movementType as Exclude<typeof movementTypes[number], 'ALL'> } : {}),
        ...(dates ? { createdAt: dates } : {}),
      };
      const [movements, totalRows] = await Promise.all([
        prisma.stockMovement.findMany({
          where,
          include: { item: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip,
          take: PAGE_SIZE,
        }),
        prisma.stockMovement.count({ where }),
      ]);
      return {
        rows: movements.map(movement => ({
          date: iso(movement.createdAt),
          item: `${movement.item.code} - ${movement.item.name}`,
          warehouse: movement.warehouse === 'FARM' ? 'Farm Warehouse' : 'Engineering Warehouse',
          type: movement.type,
          quantity: n(movement.quantity),
          quantityAfter: n(movement.quantityAfter),
          reference: movement.documentNumber || movement.referenceId,
          performedBy: movement.createdBy,
        })),
        departments,
        totalRows,
      };
    }

    case 'work-orders': {
      if (filters.status && !isOneOf(filters.status, workOrderStatuses)) throw new Error('Select a valid Job Order status.');
      if (filters.requestType && !isOneOf(filters.requestType, requestTypes)) throw new Error('Select a valid request type.');
      const department = filters.department?.trim();
      const where = {
        ...(filters.status && filters.status !== 'ALL' ? {
          status: (filters.status === 'CANCELLED' ? 'REJECTED' : filters.status) as 'PENDING' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED',
        } : {}),
        ...(filters.requestType && filters.requestType !== 'ALL' ? { type: filters.requestType as 'MRRF' | 'EPRF' } : {}),
        ...(department ? { department } : {}),
        ...(dates ? { dateRequested: dates } : {}),
      };
      const [workOrders, totalRows, allDepartments] = await Promise.all([
        prisma.workOrder.findMany({
          where,
          include: { _count: { select: { items: true } } },
          orderBy: [{ dateRequested: 'desc' }, { id: 'asc' }],
          skip,
          take: PAGE_SIZE,
        }),
        prisma.workOrder.count({ where }),
        prisma.workOrder.findMany({ select: { department: true }, distinct: ['department'], orderBy: { department: 'asc' } }),
      ]);
      departments.push(...allDepartments.map(row => row.department));
      return {
        rows: workOrders.map(workOrder => ({
          workOrder: workOrder.woNumber,
          date: iso(workOrder.dateRequested),
          department: workOrder.department,
          requestType: workOrder.type,
          status: workOrder.status === 'REJECTED' ? 'CANCELLED' : workOrder.status,
          requestedBy: workOrder.requestedBy,
          equipment: workOrder.machineEquipment,
          priority: workOrder.priority,
          itemCount: workOrder._count.items,
        })),
        departments,
        totalRows,
      };
    }

    case 'mrs': {
      if (filters.status && !isOneOf(filters.status, mrsStatuses)) throw new Error('Select a valid MRS status.');
      const where = {
        ...(filters.status && filters.status !== 'ALL' ? { status: filters.status as Exclude<typeof mrsStatuses[number], 'ALL'> } : {}),
        ...(filters.department?.trim() && filters.department !== 'ALL' ? { department: filters.department.trim() } : {}),
        ...(dates ? { dateRequested: dates } : {}),
      };
      const [mrsRecords, totalRows, allDepartments] = await Promise.all([
        prisma.mRS.findMany({
          where,
          include: { workOrder: { select: { woNumber: true } }, _count: { select: { items: true } } },
          orderBy: [{ dateRequested: 'desc' }, { id: 'asc' }],
          skip,
          take: PAGE_SIZE,
        }),
        prisma.mRS.count({ where }),
        prisma.mRS.findMany({ select: { department: true }, distinct: ['department'], orderBy: { department: 'asc' } }),
      ]);
      departments.push(...allDepartments.map(row => row.department));
      return {
        rows: mrsRecords.map(mrs => ({
          mrsNumber: mrs.mrsNumber,
          workOrder: mrs.workOrder?.woNumber || '-',
          date: iso(mrs.dateRequested),
          department: mrs.department,
          requestedBy: mrs.requestedBy,
          status: mrs.status === 'REJECTED' ? 'CANCELLED' : mrs.status,
          itemCount: mrs._count.items,
        })),
        departments,
        totalRows,
      };
    }

    case 'issuance': {
      const [issuedMRS, allDepartments] = await Promise.all([
        prisma.mRS.findMany({
          where: {
            status: { in: ['ISSUED', 'FULFILLED'] },
            ...(filters.department?.trim() && filters.department !== 'ALL' ? { department: filters.department.trim() } : {}),
            items: { some: { quantityIssued: { gt: 0 } } },
          },
          select: { mrsNumber: true, department: true },
        }),
        prisma.mRS.findMany({ select: { department: true }, distinct: ['department'], orderBy: { department: 'asc' } }),
      ]);
      const mrsByNumber = new Map(issuedMRS.map(mrs => [mrs.mrsNumber, mrs.department]));
      departments.push(...allDepartments.map(row => row.department));
      const where = {
        type: 'ISSUANCE' as const,
        referenceType: 'MRS',
        referenceId: { in: issuedMRS.map(mrs => mrs.mrsNumber) },
        ...(warehouse ? { warehouse } : {}),
        ...(dates ? { createdAt: dates } : {}),
      };
      if (issuedMRS.length === 0) return { rows: [], departments, totalRows: 0 };
      const [movements, totalRows] = await Promise.all([
        prisma.stockMovement.findMany({
          where,
          include: { item: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip,
          take: PAGE_SIZE,
        }),
        prisma.stockMovement.count({ where }),
      ]);
      return {
        rows: movements.map(movement => ({
          date: iso(movement.createdAt),
          mrsNumber: movement.referenceId,
          itemCode: movement.item.code,
          item: movement.item.name,
          warehouse: movement.warehouse === 'FARM' ? 'Farm Warehouse' : 'Engineering Warehouse',
          quantity: Math.abs(n(movement.quantity)),
          department: mrsByNumber.get(movement.referenceId) || '-',
          performedBy: movement.createdBy,
        })),
        departments,
        totalRows,
      };
    }

    case 'receiving': {
      const where = {
        ...(warehouse ? { warehouse } : {}),
        ...(dates ? { receivedDate: dates } : {}),
      };
      const [reports, totalRows] = await Promise.all([
        prisma.receiving.findMany({
          where,
          include: { _count: { select: { items: true } } },
          orderBy: [{ receivedDate: 'desc' }, { id: 'asc' }],
          skip,
          take: PAGE_SIZE,
        }),
        prisma.receiving.count({ where }),
      ]);
      return {
        rows: reports.map(receiving => ({
          rrNumber: receiving.rrNumber,
          date: iso(receiving.receivedDate),
          drNumber: receiving.drNumber,
          invoiceNumber: receiving.invoiceNumber,
          warehouse: receiving.warehouse === 'FARM' ? 'Farm Warehouse' : 'Engineering Warehouse',
          receivedBy: receiving.receivedBy,
          itemCount: receiving._count.items,
        })),
        departments,
        totalRows,
      };
    }

    case 'stock-transfers': {
      const transferWhere = {
        ...(warehouse ? { OR: [{ transferredFrom: warehouse }, { transferredTo: warehouse }] } : {}),
        ...(dates ? { dateTransferred: dates } : {}),
      };
      const itemWhere = { transfer: { is: transferWhere } };
      const [transferItems, totalRows] = await Promise.all([
        prisma.stockTransferItem.findMany({
          where: itemWhere,
          include: {
            item: true,
            transfer: { select: { transferNo: true, dateTransferred: true, transferredFrom: true, transferredTo: true, performedBy: true } },
          },
          orderBy: [{ transfer: { dateTransferred: 'desc' } }, { id: 'asc' }],
          skip,
          take: PAGE_SIZE,
        }),
        prisma.stockTransferItem.count({ where: itemWhere }),
      ]);
      return {
        rows: transferItems.map(item => ({
          transferNo: item.transfer.transferNo,
          date: iso(item.transfer.dateTransferred),
          transferredFrom: item.transfer.transferredFrom === 'FARM' ? 'Farm Warehouse' : 'Engineering Warehouse',
          transferredTo: item.transfer.transferredTo === 'FARM' ? 'Farm Warehouse' : 'Engineering Warehouse',
          itemCode: item.item.code,
          item: item.item.name,
          quantity: n(item.quantity),
          performedBy: item.transfer.performedBy,
        })),
        departments,
        totalRows,
      };
    }
  }
}
