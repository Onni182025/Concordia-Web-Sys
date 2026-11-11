'use client';

import React, { useState, useEffect } from 'react';
import type { StockMovement, Item } from '@/lib/erp-types';
import { getMovementListPage } from '@/app/actions/erp-actions';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowDownLeft, ArrowUpRight, RefreshCw, History, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/rbac';
import { TablePagination } from '@/components/shared/table-pagination';

export default function MovementsPage() {
  const { user } = useAuth();
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [filters, setFilters] = useState({ from: '', to: '', warehouse: 'ALL', type: 'ALL', itemId: 'ALL', search: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [listPage, setListPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    getMovementListPage({ ...filters, page: listPage } as Parameters<typeof getMovementListPage>[0], user.id).then(data => { setMovements(data.rows); setItems(data.items); setListTotal(data.total); setError(''); }).catch(() => setError('Unable to load movement history.')).finally(() => setLoading(false));
  }, [filters, listPage, user?.id]);

  const updateFilter = (key: keyof typeof filters, value: string) => { setFilters(current => ({ ...current, [key]: value })); setListPage(1); };
  const typeClass = (type: StockMovement['type']) => type === 'RECEIVING' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : type === 'ISSUANCE' ? 'bg-amber-100 text-amber-800 border-amber-200' : type === 'TRANSFER' ? 'bg-purple-100 text-purple-800 border-purple-200' : 'bg-blue-100 text-blue-800 border-blue-200';

  if (!can(user?.role, 'movements:view', user?.permissions)) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">Access Restricted</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Stock Movement Audit Trail</h1>
        <p className="text-sm text-neutral-500">Complete traceability of all stock additions, issuances, and restocks</p>
      </div>

      <Card className="shadow-sm">
        <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-6">
          <div className="flex items-center gap-2 rounded-md border px-3"><Search className="h-4 w-4 shrink-0 text-neutral-400" /><Input value={filters.search} onChange={event => updateFilter('search', event.target.value)} placeholder="Search item name or code" className="border-0 px-0 shadow-none focus-visible:ring-0" />{filters.search && <Button type="button" variant="ghost" size="icon" aria-label="Clear item search" onClick={() => updateFilter('search', '')}><X className="h-4 w-4" /></Button>}</div>
          <div className="flex items-center gap-2 rounded-md border px-3"><Search className="h-4 w-4 text-neutral-400" /><Input type="date" value={filters.from} onChange={event => updateFilter('from', event.target.value)} className="border-0 px-0 shadow-none focus-visible:ring-0" /></div>
          <Input type="date" value={filters.to} onChange={event => updateFilter('to', event.target.value)} />
          <Select value={filters.warehouse} onValueChange={value => updateFilter('warehouse', value)}><SelectTrigger><SelectValue placeholder="Warehouse" /></SelectTrigger><SelectContent><SelectItem value="ALL">All warehouses</SelectItem><SelectItem value="FARM">Farm Warehouse</SelectItem><SelectItem value="ENGINEERING">Engineering Warehouse</SelectItem></SelectContent></Select>
          <Select value={filters.type} onValueChange={value => updateFilter('type', value)}><SelectTrigger><SelectValue placeholder="Movement type" /></SelectTrigger><SelectContent><SelectItem value="ALL">All movement types</SelectItem><SelectItem value="RECEIVING">Receiving</SelectItem><SelectItem value="RESTOCK">Restock</SelectItem><SelectItem value="ISSUANCE">Issuance</SelectItem><SelectItem value="ADJUSTMENT">Adjustment</SelectItem><SelectItem value="TRANSFER">Transfer</SelectItem></SelectContent></Select>
          <Select value={filters.itemId} onValueChange={value => updateFilter('itemId', value)}><SelectTrigger><SelectValue placeholder="Item" /></SelectTrigger><SelectContent><SelectItem value="ALL">All items</SelectItem>{items.map(item => <SelectItem key={item.id} value={item.id}>{item.code} - {item.name}</SelectItem>)}</SelectContent></Select>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <History className="h-5 w-5 text-emerald-600" />
            Audit Log
          </CardTitle>
          <CardDescription>Every stock change is recorded with warehouse, user, and timestamp</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Item</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Quantity Change</TableHead>
                  <TableHead className="text-right">Quantity After</TableHead>
                  <TableHead>Reference</TableHead>
                <TableHead>Performed By</TableHead>
                <TableHead>Remarks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-neutral-400">Loading movement history...</TableCell></TableRow>
              ) : error ? (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-red-600">{error}</TableCell></TableRow>
              ) : movements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-neutral-400">
                    No stock movements recorded yet. Try restocking or issuing items.
                  </TableCell>
                </TableRow>
              ) : (
                movements.map((move) => {
                  const item = items.find(i => i.id === move.itemId);
                  const isAddition = move.quantity > 0;

                  return (
                    <TableRow key={move.id}>
                      <TableCell className="text-neutral-500 text-xs">{new Date(move.createdAt).toLocaleString()}</TableCell>
                      <TableCell><p className="font-bold text-neutral-700">{item?.code}</p><p className="text-xs text-neutral-500">{item?.name}</p></TableCell>
                      <TableCell>
                        <Badge variant="outline" className={move.warehouse === 'FARM' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}>{move.warehouse === 'FARM' ? 'Farm' : 'Engineering'}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          className={cn(
                            "font-semibold flex items-center gap-1 w-fit",
                            move.type === 'RECEIVING' ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
                            typeClass(move.type)
                          )}
                        >
                          {move.type === 'RECEIVING' && <ArrowDownLeft className="h-3 w-3" />}
                          {move.type === 'ISSUANCE' && <ArrowUpRight className="h-3 w-3" />}
                          {move.type === 'RESTOCK' && <RefreshCw className="h-3 w-3" />}
                          {move.type === 'TRANSFER' && <RefreshCw className="h-3 w-3" />}
                          {move.type}
                        </Badge>
                      </TableCell>
                      <TableCell className={cn(
                        "text-right font-bold",
                        isAddition ? "text-emerald-600" : "text-red-600"
                      )}>
                        {isAddition ? `+${move.quantity}` : move.quantity} {item?.unit}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-neutral-700">{move.quantityAfter} {item?.unit}</TableCell>
                      <TableCell><p className="font-medium">{move.referenceType}</p><p className="text-xs text-neutral-500">{move.referenceId}</p></TableCell>
                      <TableCell className="text-neutral-600 text-sm">{move.createdBy}</TableCell>
                      <TableCell className="max-w-56 text-sm text-neutral-600">{move.remarks || '—'}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
        <TablePagination page={listPage} pageSize={20} total={listTotal} onPageChange={setListPage} />
      </Card>
    </div>
  );
}
