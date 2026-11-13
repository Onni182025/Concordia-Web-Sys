'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Printer, RefreshCw } from 'lucide-react';
import { getReportData } from '@/app/actions/report-actions';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/rbac';
import { reportDefinitions, type ReportFilters, type ReportKey, type ReportRow, type ReportRowValue } from '@/lib/reports';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type ReportViewProps = {
  report: ReportKey;
};

const PAGE_SIZE = 20;

function displayValue(key: string, value: ReportRowValue): string {
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'date' && typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }
  if (key === 'status' && typeof value === 'string') {
    return value === 'CANCELLED'
      ? 'Cancelled'
      : value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
  }
  if ((key === 'warehouse' || key === 'transferredFrom' || key === 'transferredTo') && typeof value === 'string') {
    return value.replace(/_/g, ' ');
  }
  return String(value);
}

function csvCell(value: ReportRowValue): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export default function ReportView({ report }: ReportViewProps) {
  const { user } = useAuth();
  const definition = reportDefinitions[report];
  const [filters, setFilters] = useState<ReportFilters>({});
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [departments, setDepartments] = useState<string[]>([]);
  const [reportDate, setReportDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printRows, setPrintRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    setLoading(true);
    getReportData(report, filters, user.id, page)
      .then(result => {
        if (!active) return;
        setRows(result.rows);
        setTotalRows(result.totalRows);
        setDepartments(result.departments);
        if (result.reportDate) setReportDate(result.reportDate);
        setError('');
      })
      .catch(cause => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : 'Unable to load this report.');
        setRows([]);
        setTotalRows(0);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filters, page, report, user?.id]);

  const updateFilter = (key: keyof ReportFilters, value: string) => {
    setFilters(current => ({ ...current, [key]: value }));
    setPage(1);
  };

  const getAllRows = async () => {
    if (!user?.id) return [];
    const firstPage = await getReportData(report, filters, user.id, 1);
    const allRows = [...firstPage.rows];
    const pageCount = Math.ceil(firstPage.totalRows / PAGE_SIZE);
    for (let currentPage = 2; currentPage <= pageCount; currentPage += 1) {
      const result = await getReportData(report, filters, user.id, currentPage);
      allRows.push(...result.rows);
    }
    return allRows;
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const allRows = await getAllRows();
      const csv = [
        ...(report === 'stock-inventory' ? [csvCell(`Stock inventory as of ${reportDate || new Date().toISOString().slice(0, 10)}`)] : []),
        definition.columns.map(column => csvCell(column.label)).join(','),
        ...allRows.map(row => definition.columns.map(column => csvCell(row[column.key])).join(',')),
      ].join('\r\n');
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `concordia-${report}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to export this report.');
    } finally {
      setExporting(false);
    }
  };

  const printReport = async () => {
    setPrinting(true);
    try {
      setPrintRows(await getAllRows());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to print this report.');
    } finally {
      setPrinting(false);
    }
  };

  useEffect(() => {
    if (printRows === null) return;
    const finishPrint = () => setPrintRows(null);
    window.addEventListener('afterprint', finishPrint);
    window.print();
    return () => window.removeEventListener('afterprint', finishPrint);
  }, [printRows]);

  const visibleRows = printRows ?? rows;
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const firstRow = totalRows === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(page * PAGE_SIZE, totalRows);

  const showDateFilter = ['stock-movements', 'work-orders', 'mrs', 'issuance', 'receiving', 'stock-transfers'].includes(report);
  const showWarehouseFilter = ['stock-inventory', 'low-stock', 'stock-movements', 'issuance', 'receiving', 'stock-transfers'].includes(report);

  if (!can(user?.role, 'reports:view', user?.permissions)) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">You do not have permission to view reports.</div>;
  }

  return (
    <div className="report-page space-y-6">
      <header className="reports-toolbar flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2"><Badge className="bg-emerald-100 text-emerald-800">Reports</Badge></div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{definition.title}</h1>
          <p className="mt-1 text-sm text-neutral-500">{definition.description}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={printReport} disabled={loading || printing}>
            <Printer className="mr-2 h-4 w-4" />Print
          </Button>
          <Button type="button" onClick={exportCsv} disabled={loading || exporting || totalRows === 0} className="bg-emerald-600 text-white hover:bg-emerald-700">
            <Download className="mr-2 h-4 w-4" />Export CSV
          </Button>
        </div>
      </header>

      <Card className="reports-toolbar shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Report Filters</CardTitle>
          <CardDescription>Filters are applied on the server when the report refreshes.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {showDateFilter && (
            <>
              <label className="flex items-center gap-2 text-sm text-neutral-600">
                <span>From</span>
                <Input aria-label="From date" type="date" value={filters.from || ''} onChange={event => updateFilter('from', event.target.value)} className="w-auto" />
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-600">
                <span>To</span>
                <Input aria-label="To date" type="date" value={filters.to || ''} onChange={event => updateFilter('to', event.target.value)} className="w-auto" />
              </label>
            </>
          )}

          {showWarehouseFilter && (
            <Select value={filters.warehouse || 'ALL'} onValueChange={value => updateFilter('warehouse', value)}>
              <SelectTrigger aria-label="Warehouse filter" className="w-[210px]"><SelectValue placeholder="Warehouse" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All warehouses</SelectItem>
                <SelectItem value="FARM">Farm Warehouse</SelectItem>
                <SelectItem value="ENGINEERING">Engineering Warehouse</SelectItem>
              </SelectContent>
            </Select>
          )}

          {report === 'stock-movements' && (
            <Select value={filters.movementType || 'ALL'} onValueChange={value => updateFilter('movementType', value)}>
              <SelectTrigger aria-label="Movement type filter" className="w-[190px]"><SelectValue placeholder="Movement type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All movement types</SelectItem>
                <SelectItem value="RECEIVING">Receiving</SelectItem>
                <SelectItem value="ISSUANCE">Issuance</SelectItem>
                <SelectItem value="TRANSFER">Transfer</SelectItem>
                <SelectItem value="RESTOCK">Restock</SelectItem>
                <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
              </SelectContent>
            </Select>
          )}

          {(report === 'work-orders' || report === 'mrs') && (
            <Select value={filters.status || 'ALL'} onValueChange={value => updateFilter('status', value)}>
              <SelectTrigger aria-label="Status filter" className="w-[190px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {report === 'work-orders' ? (
                  <>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="APPROVED">Approved</SelectItem>
                    <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                    <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="APPROVED">Approved</SelectItem>
                    <SelectItem value="ISSUED">Issued</SelectItem>
                    <SelectItem value="FULFILLED">Fulfilled</SelectItem>
                    <SelectItem value="REJECTED">Rejected</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          )}

          {report === 'work-orders' && (
            <Select value={filters.requestType || 'ALL'} onValueChange={value => updateFilter('requestType', value)}>
              <SelectTrigger aria-label="Request type filter" className="w-[170px]"><SelectValue placeholder="Request type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All request types</SelectItem>
                <SelectItem value="MRRF">MRRF</SelectItem>
                <SelectItem value="EPRF">EPRF</SelectItem>
              </SelectContent>
            </Select>
          )}

          {['work-orders', 'mrs', 'issuance'].includes(report) && (
            <Select value={filters.department || 'ALL'} onValueChange={value => updateFilter('department', value)}>
              <SelectTrigger aria-label="Department filter" className="w-[200px]"><SelectValue placeholder="Department" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All departments</SelectItem>
                {departments.map(department => <SelectItem key={department} value={department}>{department}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          <Button type="button" variant="ghost" onClick={() => setFilters({})} disabled={Object.keys(filters).length === 0}>
            <RefreshCw className="mr-2 h-4 w-4" />Clear filters
          </Button>
        </CardContent>
      </Card>

      <Card className="report-content shadow-sm">
        <CardHeader className="border-b">
          <CardTitle className="text-base">{definition.title}</CardTitle>
          <CardDescription>
            {loading ? 'Loading report data…' : `${totalRows.toLocaleString()} record${totalRows === 1 ? '' : 's'}`}
            {report === 'stock-inventory' && <span className="ml-2 font-medium text-neutral-700">· Inventory date: {reportDate || new Date().toISOString().slice(0, 10)} (current balance)</span>}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {definition.columns.map(column => <TableHead key={column.key}>{column.label}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={definition.columns.length} className="py-10 text-center text-neutral-500">Loading report data…</TableCell></TableRow>
                ) : error ? (
                  <TableRow><TableCell colSpan={definition.columns.length} className="py-10 text-center text-red-600">{error}</TableCell></TableRow>
                ) : visibleRows.length === 0 ? (
                  <TableRow><TableCell colSpan={definition.columns.length} className="py-10 text-center text-neutral-500">No records match this report and its filters.</TableCell></TableRow>
                ) : visibleRows.map((row, index) => (
                  <TableRow key={`${String(row[definition.columns[0].key] ?? 'row')}-${index}`}>
                    {definition.columns.map(column => (
                      <TableCell key={column.key} className={column.key === 'quantity' || column.key === 'quantityAfter' || column.key === 'reorderLevel' || column.key === 'itemCount' ? 'text-right tabular-nums' : undefined}>
                        {displayValue(column.key, row[column.key])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="reports-toolbar flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
            <p className="text-sm text-neutral-600">
              Showing {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of {totalRows.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-600">Page {page} of {pageCount}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={loading || page <= 1} aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" />Previous
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setPage(current => Math.min(pageCount, current + 1))} disabled={loading || page >= pageCount} aria-label="Next page">
                Next<ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
