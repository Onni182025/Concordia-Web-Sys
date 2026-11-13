'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { BarChart3, Boxes, Eye, LineChart as LineChartIcon, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { CartesianGrid, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import type { Item, Role, StockMovement, Warehouse, WarehouseStock } from '@/lib/erp-types';
import { bulkCreateInventoryItems, deleteInventoryItem, getInventoryData, getInventoryListPage, getItemMovementHistory, restockInventory, saveInventoryItem } from '@/app/actions/erp-actions';
import { useAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { can, stockSubLocationsForRole, warehouseForRole } from '@/lib/rbac';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import StockTransferDialog from './stock-transfer-dialog';
import { TablePagination } from '@/components/shared/table-pagination';

const itemSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required'),
  code: z.string().trim().min(1, 'Item code is required'),
  category: z.string().trim().min(1, 'Category is required'),
  quantity: z.coerce.number().min(0, 'Quantity cannot be negative'),
  unit: z.string().trim().min(1, 'Unit is required'),
  reorderLevel: z.coerce.number().min(0, 'Reorder level cannot be negative'),
  location: z.enum(['FARM', 'ENGINEERING']),
  subLocation: z.string().trim().min(1, 'Select a stock sub-location'),
});

type ItemForm = z.infer<typeof itemSchema>;
type Modal = 'add' | 'edit' | 'view' | 'restock' | null;
const chartColors = ['#059669', '#2563eb', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];
const emptyForm: ItemForm = { name: '', code: '', category: '', quantity: 0, unit: 'pcs', reorderLevel: 0, location: 'ENGINEERING', subLocation: 'Eng. Warehouse' };

export default function InventoryPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [stocks, setStocks] = useState<WarehouseStock[]>([]);
  const [issuanceTotals, setIssuanceTotals] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState<Warehouse | 'ALL'>('ALL');
  const [modal, setModal] = useState<Modal>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<ItemForm[]>([{ ...emptyForm }]);
  const [isBulkSaving, setIsBulkSaving] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null);
  const [itemMovements, setItemMovements] = useState<StockMovement[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [form, setForm] = useState<ItemForm>(emptyForm);
  const [restock, setRestock] = useState({ quantity: '', documentNumber: '', supplier: '', remarks: '' });
  const [inventoryPageRows, setInventoryPageRows] = useState<Array<{ item: Item; stock: WarehouseStock }>>([]);
  const [listPage, setListPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);

  const isAdmin = can(user?.role, 'inventory:manage', user?.permissions);
  const canViewInventory = can(user?.role, 'inventory:view', user?.permissions);
  const restrictedLocation: Warehouse | null = warehouseForRole(user?.role);
  const visibleLocation = restrictedLocation || location;
  const refresh = useCallback(async () => { if (!user?.id || !canViewInventory) return; const data = await getInventoryData(user.id); setItems(data.items); setStocks(data.stocks); setIssuanceTotals(data.issuanceTotals); }, [canViewInventory, user?.id]);

  useEffect(() => { if (user?.id) void refresh(); }, [refresh, user?.id]);

  useEffect(() => {
    if (!user?.id || !canViewInventory) return;
    getInventoryListPage({ page: listPage, search: query, warehouse: visibleLocation }, user.id)
      .then(result => { setInventoryPageRows(result.rows); setListTotal(result.total); })
      .catch(error => toast({ title: 'Unable to load stock items', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }));
  }, [canViewInventory, listPage, query, user?.id, visibleLocation]);

  useEffect(() => {
    if (modal !== 'view' || !selected) return;
    setHistoryLoading(true);
    if (!user?.id) return;
    void getItemMovementHistory(selected.id, historyPage, user.id)
      .then(result => { setItemMovements(result.rows); setHistoryTotal(result.total); })
      .catch(error => toast({ title: 'Unable to load transaction history', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }))
      .finally(() => setHistoryLoading(false));
  }, [historyPage, modal, selected, user?.id]);

  const rows = useMemo(() => items.flatMap(item => stocks.filter(stock => stock.itemId === item.id && (visibleLocation === 'ALL' || stock.warehouse === visibleLocation)).map(stock => ({ item, stock }))), [items, stocks, visibleLocation]);
  const filteredRows = inventoryPageRows;
  const totalItems = rows.length;
  const lowStocks = rows.filter(row => row.stock.quantity <= row.stock.minStockLevel).length;
  const topItems = Object.values(rows.reduce<Record<string, { name: string; quantity: number }>>((acc, row) => { acc[row.item.id] = { name: row.item.name, quantity: (acc[row.item.id]?.quantity || 0) + row.stock.quantity }; return acc; }, {})).sort((a, b) => b.quantity - a.quantity).slice(0, 8);
  const categoryData = Object.values(rows.reduce<Record<string, { name: string; value: number }>>((acc, row) => { acc[row.item.category] = { name: row.item.category, value: (acc[row.item.category]?.value || 0) + row.stock.quantity }; return acc; }, {}));

  const openAdd = () => {
    const targetWarehouse = restrictedLocation || 'ENGINEERING';
    setSelected(null);
    setForm({ ...emptyForm, location: targetWarehouse, subLocation: stockSubLocationsForRole(user?.role, targetWarehouse)[0] });
    setModal('add');
  };
  const openEdit = (item: Item, stock: WarehouseStock) => {
    setSelected(item);
    const subLocations = stockSubLocationsForRole(user?.role, stock.warehouse);
    setForm({ name: item.name, code: item.code, category: item.category, quantity: stock.quantity, unit: item.unit, reorderLevel: stock.minStockLevel, location: stock.warehouse, subLocation: subLocations.includes(stock.subLocation) ? stock.subLocation : subLocations[0] });
    setModal('edit');
  };
  const openView = (item: Item) => {
    setSelected(item);
    setItemMovements([]);
    setHistoryTotal(0);
    setHistoryPage(1);
    setModal('view');
  };

  const saveItem = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = itemSchema.safeParse(form);
    if (!parsed.success) { toast({ title: 'Check the item details', description: parsed.error.issues[0].message, variant: 'destructive' }); return; }
    if (restrictedLocation && parsed.data.location !== restrictedLocation) { toast({ title: 'Unauthorized location', description: 'Your role can only manage its assigned warehouse.', variant: 'destructive' }); return; }
    try {
      if (!user) throw new Error('You must be signed in.');
      const item = await saveInventoryItem({ id: selected?.id, ...parsed.data, description: selected?.description || '', createdBy: user.name, userId: user.id });
      await refresh(); setModal(null);
      toast({ title: selected ? 'Item updated' : 'Stock item added', description: `${item.name} is tracked at ${parsed.data.subLocation}.` });
    } catch (error) { toast({ title: 'Unable to save item', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }); }
  };

  const updateBulkRow = (index: number, key: keyof ItemForm, value: string) => {
    setBulkRows(current => current.map((row, rowIndex) => rowIndex !== index ? row : {
      ...row,
      [key]: key === 'quantity' || key === 'reorderLevel' ? Number(value) : value,
      ...(key === 'location' ? { subLocation: stockSubLocationsForRole(user?.role, value as Warehouse)[0] } : {}),
    }));
  };

  const submitBulk = async (event: React.FormEvent) => {
    event.preventDefault();
    if (bulkRows.length === 0) {
      toast({ title: 'No stock items to save', description: 'Add at least one row and try again.', variant: 'destructive' });
      return;
    }
    if (!user?.id) {
      toast({ title: 'Unable to save stock items', description: 'You must be signed in.', variant: 'destructive' });
      return;
    }
    setIsBulkSaving(true);
    try {
      const result = await bulkCreateInventoryItems({ rows: bulkRows, userId: user.id });
      const errors = result.errors;
      if (result.createdCount > 0) {
        await refresh();
        setBulkOpen(false);
        setBulkRows([{ ...emptyForm, location: restrictedLocation || 'ENGINEERING', subLocation: stockSubLocationsForRole(user.role, restrictedLocation || 'ENGINEERING')[0] }]);
      }
      toast({
        title: `Saved ${result.createdCount} stock item${result.createdCount === 1 ? '' : 's'}`,
        description: errors.length ? errors.map(error => `Row ${error.row}: ${error.message}`).join(' · ') : 'All valid rows were saved successfully.',
        variant: errors.length ? 'destructive' : 'default',
      });
    } catch (error) {
      toast({ title: 'Unable to save stock items', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' });
    } finally {
      setIsBulkSaving(false);
    }
  };

  const saveRestock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const quantity = Number(restock.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || !restock.documentNumber.trim() || !restock.supplier.trim()) { toast({ title: 'Incomplete restock details', description: 'Enter a positive quantity, document number, and supplier.', variant: 'destructive' }); return; }
    const targetWarehouse = visibleLocation === 'ALL' ? 'ENGINEERING' : visibleLocation;
    try {
      if (!user) throw new Error('You must be signed in.');
      const target = await restockInventory({ itemId: selected.id, warehouse: targetWarehouse, quantity, documentNumber: restock.documentNumber.trim(), supplier: restock.supplier.trim(), remarks: restock.remarks.trim(), createdBy: user.name, userId: user.id });
      await refresh(); setRestock({ quantity: '', documentNumber: '', supplier: '', remarks: '' }); setModal(null);
      toast({ title: 'Stock replenished', description: `${quantity} ${selected.unit} added to ${target.warehouse} Warehouse.` });
    } catch (error) { toast({ title: 'Unable to restock', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }); }
  };

  const deleteItem = async (item: Item) => {
    if (!isAdmin || !window.confirm(`Delete ${item.name} and its warehouse stock?`)) return;
    try {
      if (!user) throw new Error('You must be signed in.');
      const result = await deleteInventoryItem(item.id, user.id);
      if (!result.ok) {
        toast({ title: 'Unable to delete item', description: result.error, variant: 'destructive' });
        return;
      }
      await refresh();
    } catch {
      toast({
        title: 'Unable to delete item',
        description: 'The item could not be deleted. Refresh the inventory and try again.',
        variant: 'destructive',
      });
      return;
    }
    toast({ title: 'Item deleted', description: `${item.name} was removed from inventory.` });
  };
  const totalIssuance = (itemId: string) => issuanceTotals[itemId] || 0;

  if (user && !canViewInventory) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900"><h1 className="text-xl font-bold">Access Restricted</h1><p className="mt-2 text-sm">Your role does not have permission to view inventory.</p></div>;

  return <div className="space-y-6 pb-10">
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600">Warehouse control</p><h1 className="text-3xl font-bold tracking-tight text-neutral-900">Inventory Management</h1><p className="mt-1 text-sm text-neutral-500">Separate, auditable stock for Farm and Engineering warehouses.</p></div><div className="flex flex-wrap gap-3">{user && can(user.role, 'inventory:transfer', user.permissions) && <StockTransferDialog items={items} stocks={stocks} performedBy={user.name} userId={user.id} restrictedSource={restrictedLocation} onSuccess={refresh} />}{isAdmin && <><Button onClick={openAdd} className="bg-emerald-600 text-white hover:bg-emerald-700"><Plus className="mr-2 h-4 w-4" />Add New Stock Item</Button><Button variant="outline" onClick={() => { const warehouse = restrictedLocation || 'ENGINEERING'; setBulkRows([{ ...emptyForm, location: warehouse, subLocation: stockSubLocationsForRole(user?.role, warehouse)[0] }]); setBulkOpen(true); }}>Bulk Add Stock Items</Button></>}</div></div>
    <div className="grid gap-4 md:grid-cols-2"><MetricCard title="Total Items" value={totalItems.toLocaleString()} icon={Boxes} /><MetricCard title="Low Stocks" value={lowStocks.toString()} icon={BarChart3} danger={lowStocks > 0} /></div>
    <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]"><Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><LineChartIcon className="h-4 w-4 text-emerald-600" />Top Items by Quantity</CardTitle></CardHeader><CardContent className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={topItems} margin={{ left: 8, right: 16, top: 8, bottom: 36 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" /><XAxis dataKey="name" angle={-25} textAnchor="end" height={60} tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Line type="monotone" dataKey="quantity" stroke="#059669" strokeWidth={3} dot={{ r: 4 }} /></LineChart></ResponsiveContainer></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Units by Category</CardTitle></CardHeader><CardContent className="h-72"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={88} label>{categoryData.map((entry, index) => <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></CardContent></Card></div>
    <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm md:flex-row"><div className="flex flex-1 items-center gap-2"><Search className="h-4 w-4 text-neutral-400" /><Input value={query} onChange={event => { setQuery(event.target.value); setListPage(1); }} placeholder="Search by item name, code, or category" className="border-0 shadow-none focus-visible:ring-0" />{query && <Button type="button" variant="ghost" size="icon" aria-label="Clear item search" onClick={() => { setQuery(''); setListPage(1); }}><X className="h-4 w-4" /></Button>}</div><Select value={visibleLocation} onValueChange={value => { setLocation(value as Warehouse | 'ALL'); setListPage(1); }} disabled={Boolean(restrictedLocation)}><SelectTrigger className="w-full md:w-56"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All Locations</SelectItem><SelectItem value="FARM">Farm Warehouse</SelectItem><SelectItem value="ENGINEERING">Engineering Warehouse</SelectItem></SelectContent></Select></div>
    <Card><CardHeader><CardTitle className="text-base">Stock Items <span className="font-normal text-neutral-400">({listTotal.toLocaleString()} location records)</span></CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Category</TableHead><TableHead>Location</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Reorder Level</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{filteredRows.length === 0 ? <TableRow><TableCell colSpan={7} className="py-10 text-center text-neutral-400">No stock items found.</TableCell></TableRow> : filteredRows.map(({ item, stock }) => <TableRow key={stock.id}><TableCell><p className="font-semibold text-neutral-900">{item.name}</p><p className="font-mono text-xs text-neutral-500">{item.code} · {item.unit}</p></TableCell><TableCell>{item.category}</TableCell><TableCell><Badge variant="outline" className={stock.warehouse === 'FARM' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}>{stock.warehouse === 'FARM' ? 'Farm Warehouse' : 'Engineering Warehouse'} · {stock.subLocation || 'Unspecified'}</Badge></TableCell><TableCell className="text-right font-semibold">{stock.quantity} {item.unit}</TableCell><TableCell className="text-right text-neutral-500">{stock.minStockLevel} {item.unit}</TableCell><TableCell>{stock.quantity <= stock.minStockLevel ? <Badge className="bg-red-100 text-red-700">Low stock</Badge> : <Badge className="bg-emerald-100 text-emerald-700">Healthy</Badge>}</TableCell><TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" title="View stock" onClick={() => openView(item)}><Eye className="h-4 w-4" /></Button>{isAdmin && <><Button variant="ghost" size="icon" title="Edit item" onClick={() => openEdit(item, stock)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" title="Restock" onClick={() => { setSelected(item); setModal('restock'); }}><Plus className="h-4 w-4" /></Button><Button variant="ghost" size="icon" title="Delete item" onClick={() => deleteItem(item)}><Trash2 className="h-4 w-4 text-red-600" /></Button></>}</div></TableCell></TableRow>)}</TableBody></Table></CardContent><TablePagination page={listPage} pageSize={20} total={listTotal} onPageChange={setListPage} /></Card>
    <Dialog open={modal === 'add' || modal === 'edit'} onOpenChange={open => !open && setModal(null)}><DialogContent><DialogHeader><DialogTitle>{modal === 'edit' ? 'Edit Stock Item' : 'Add New Stock Item'}</DialogTitle><DialogDescription>Maintain the item master and its warehouse balance.</DialogDescription></DialogHeader><ItemForm form={form} setForm={setForm} restrictedLocation={restrictedLocation} userRole={user?.role} onSubmit={saveItem} submitLabel={modal === 'edit' ? 'Save Changes' : 'Add Stock Item'} /></DialogContent></Dialog>
    <Dialog open={bulkOpen} onOpenChange={open => { if (!isBulkSaving) setBulkOpen(open); }}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Add Stock Items</DialogTitle>
          <DialogDescription>Enter up to 100 items. Valid rows are saved together in one transaction; invalid rows are reported individually.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submitBulk} className="space-y-4">
          {bulkRows.map((row, index) => {
            const subLocations = stockSubLocationsForRole(user?.role, row.location);
            return <div key={index} className="grid gap-3 rounded-lg border bg-neutral-50 p-3 md:grid-cols-4">
              <Field label={`Row ${index + 1} · Item Name *`}><Input value={row.name} onChange={event => updateBulkRow(index, 'name', event.target.value)} /></Field>
              <Field label="Item Code *"><Input value={row.code} onChange={event => updateBulkRow(index, 'code', event.target.value)} /></Field>
              <Field label="Category *"><Input value={row.category} onChange={event => updateBulkRow(index, 'category', event.target.value)} /></Field>
              <Field label="Quantity *"><Input type="number" min="0" step="any" value={row.quantity} onChange={event => updateBulkRow(index, 'quantity', event.target.value)} /></Field>
              <Field label="Unit *"><Input value={row.unit} onChange={event => updateBulkRow(index, 'unit', event.target.value)} /></Field>
              <Field label="Reorder Level *"><Input type="number" min="0" step="any" value={row.reorderLevel} onChange={event => updateBulkRow(index, 'reorderLevel', event.target.value)} /></Field>
              <Field label="Warehouse *"><Select value={row.location} onValueChange={value => updateBulkRow(index, 'location', value)} disabled={Boolean(restrictedLocation)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="FARM">Farm Warehouse</SelectItem><SelectItem value="ENGINEERING">Engineering Warehouse</SelectItem></SelectContent></Select></Field>
              <div className="flex items-end gap-2"><Field label="Sub-location *"><Select value={row.subLocation} onValueChange={value => updateBulkRow(index, 'subLocation', value)}><SelectTrigger><SelectValue placeholder="Select sub-location" /></SelectTrigger><SelectContent>{subLocations.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field><Button type="button" variant="ghost" size="icon" aria-label={`Remove row ${index + 1}`} disabled={bulkRows.length === 1} onClick={() => setBulkRows(current => current.filter((_, rowIndex) => rowIndex !== index))}><Trash2 className="h-4 w-4 text-red-600" /></Button></div>
            </div>;
          })}
          <div className="flex flex-wrap justify-between gap-2">
            <Button type="button" variant="outline" disabled={bulkRows.length >= 100} onClick={() => { const warehouse = restrictedLocation || 'ENGINEERING'; setBulkRows(current => [...current, { ...emptyForm, location: warehouse, subLocation: stockSubLocationsForRole(user?.role, warehouse)[0] }]); }}><Plus className="mr-2 h-4 w-4" />Add Row</Button>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setBulkOpen(false)} disabled={isBulkSaving}>Cancel</Button><Button type="submit" className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={isBulkSaving}>{isBulkSaving ? 'Saving…' : `Save ${bulkRows.length} Rows`}</Button></DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={modal === 'restock'} onOpenChange={open => !open && setModal(null)}><DialogContent><DialogHeader><DialogTitle>Restock {selected?.name}</DialogTitle><DialogDescription>Record the source document and supplier for this stock addition.</DialogDescription></DialogHeader><form onSubmit={saveRestock} className="space-y-4"><Field label="Quantity to Add *"><Input type="number" min="0.01" step="any" value={restock.quantity} onChange={event => setRestock({ ...restock, quantity: event.target.value })} /></Field><Field label="Unit"><Input value={selected?.unit || ''} disabled /></Field><Field label="Reference / Document No. *"><Input value={restock.documentNumber} onChange={event => setRestock({ ...restock, documentNumber: event.target.value })} placeholder="DR-2026-0001" /></Field><Field label="Supplier *"><Input value={restock.supplier} onChange={event => setRestock({ ...restock, supplier: event.target.value })} /></Field><Field label="Remarks"><Textarea value={restock.remarks} onChange={event => setRestock({ ...restock, remarks: event.target.value })} /></Field><DialogFooter><Button type="submit" className="bg-emerald-600 text-white hover:bg-emerald-700">Record Restock</Button></DialogFooter></form></DialogContent></Dialog>
    <Dialog open={modal === 'view'} onOpenChange={open => !open && setModal(null)}><DialogContent className="max-w-6xl"><DialogHeader><DialogTitle>Stock Details</DialogTitle><DialogDescription>Current stock summary and transaction history for this item.</DialogDescription></DialogHeader>{selected && <div className="space-y-6"><div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3"><Detail label="Item Name" value={selected.name} /><Detail label="Item Code" value={selected.code} /><Detail label="Category" value={selected.category} /><Detail label="Unit" value={selected.unit} /><Detail label="Total Issuance" value={`${totalIssuance(selected.id)} ${selected.unit}`} />{stocks.filter(stock => stock.itemId === selected.id).map(stock => <Detail key={stock.id} label={`${stock.warehouse === 'FARM' ? 'Farm' : 'Engineering'} Warehouse`} value={`${stock.quantity} ${selected.unit} (reorder at ${stock.minStockLevel})`} />)}</div><section className="space-y-3"><div><h3 className="font-semibold text-neutral-900">Transaction History</h3><p className="text-sm text-neutral-500">Latest stock transactions for {selected.code}.</p></div><div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Date &amp; Time</TableHead><TableHead>Movement Type</TableHead><TableHead>Warehouse</TableHead><TableHead className="text-right">Quantity Change</TableHead><TableHead className="text-right">Quantity After</TableHead><TableHead>Reference</TableHead><TableHead>Performed By</TableHead><TableHead>Remarks</TableHead></TableRow></TableHeader><TableBody>{historyLoading ? <TableRow><TableCell colSpan={8} className="py-8 text-center text-neutral-500">Loading transactions…</TableCell></TableRow> : itemMovements.length === 0 ? <TableRow><TableCell colSpan={8} className="py-8 text-center text-neutral-500">No transactions yet</TableCell></TableRow> : itemMovements.map(move => <TableRow key={move.id}><TableCell className="whitespace-nowrap text-xs text-neutral-500">{new Date(move.createdAt).toLocaleString()}</TableCell><TableCell><Badge className={cn('border', move.type === 'RECEIVING' ? 'border-emerald-200 bg-emerald-100 text-emerald-800' : move.type === 'ISSUANCE' ? 'border-amber-200 bg-amber-100 text-amber-800' : move.type === 'TRANSFER' ? 'border-purple-200 bg-purple-100 text-purple-800' : move.type === 'RESTOCK' ? 'border-blue-200 bg-blue-100 text-blue-800' : 'border-neutral-200 bg-neutral-100 text-neutral-700')}>{move.type.replace(/_/g, ' ')}</Badge></TableCell><TableCell><Badge variant="outline" className={move.warehouse === 'FARM' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}>{move.warehouse === 'FARM' ? 'Farm' : 'Engineering'}</Badge></TableCell><TableCell className={cn('text-right font-semibold', move.quantity >= 0 ? 'text-emerald-700' : 'text-red-600')}>{move.quantity >= 0 ? '+' : ''}{move.quantity} {selected.unit}</TableCell><TableCell className="text-right font-semibold">{move.quantityAfter} {selected.unit}</TableCell><TableCell><p className="text-xs text-neutral-500">{move.referenceType}</p><p className="font-medium">{move.documentNumber || move.referenceId || '-'}</p></TableCell><TableCell>{move.createdBy}</TableCell><TableCell className="max-w-48 text-sm text-neutral-600">{move.remarks || '—'}</TableCell></TableRow>)}</TableBody></Table></div><TablePagination page={historyPage} pageSize={5} total={historyTotal} onPageChange={setHistoryPage} /></section></div>}</DialogContent></Dialog>
  </div>;
}

function MetricCard({ title, value, icon: Icon, danger }: { title: string; value: string; icon: typeof Boxes; danger?: boolean }) { return <Card><CardContent className="flex items-center justify-between p-6"><div><p className="text-sm font-medium text-neutral-500">{title}</p><p className={cn('mt-2 text-3xl font-bold', danger ? 'text-red-600' : 'text-neutral-900')}>{value}</p></div><div className={cn('rounded-xl p-3', danger ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600')}><Icon className="h-6 w-6" /></div></CardContent></Card>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1.5"><label className="text-xs font-semibold uppercase tracking-wide text-neutral-600">{label}</label>{children}</div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border bg-neutral-50 p-3"><p className="text-xs text-neutral-500">{label}</p><p className="mt-1 font-semibold text-neutral-900">{value}</p></div>; }
function ItemForm({ form, setForm, restrictedLocation, userRole, onSubmit, submitLabel }: { form: ItemForm; setForm: (form: ItemForm) => void; restrictedLocation: Warehouse | null; userRole?: Role; onSubmit: (event: React.FormEvent) => void; submitLabel: string }) { const update = (key: keyof ItemForm, value: string) => setForm({ ...form, [key]: key === 'quantity' || key === 'reorderLevel' ? Number(value) : value }); const subLocations = stockSubLocationsForRole(userRole, form.location); return <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2"><Field label="Item Name *"><Input value={form.name} onChange={e => update('name', e.target.value)} /></Field><Field label="Item Code / Part Code *"><Input value={form.code} onChange={e => update('code', e.target.value)} /></Field><Field label="Category *"><Input value={form.category} onChange={e => update('category', e.target.value)} /></Field><Field label="Quantity *"><Input type="number" min="0" step="any" value={form.quantity} onChange={e => update('quantity', e.target.value)} /></Field><Field label="Unit *"><Input value={form.unit} onChange={e => update('unit', e.target.value)} /></Field><Field label="Reorder Level *"><Input type="number" min="0" step="any" value={form.reorderLevel} onChange={e => update('reorderLevel', e.target.value)} /></Field><Field label="Warehouse *"><Select value={form.location} onValueChange={value => { const warehouse = value as Warehouse; setForm({ ...form, location: warehouse, subLocation: stockSubLocationsForRole(userRole, warehouse)[0] }); }} disabled={Boolean(restrictedLocation)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="FARM">Farm Warehouse</SelectItem><SelectItem value="ENGINEERING">Engineering Warehouse</SelectItem></SelectContent></Select></Field><Field label="Sub-location *"><Select value={form.subLocation} onValueChange={value => update('subLocation', value)}><SelectTrigger><SelectValue placeholder="Select sub-location" /></SelectTrigger><SelectContent>{subLocations.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field><DialogFooter className="md:col-span-2"><Button type="submit" className="bg-emerald-600 text-white hover:bg-emerald-700">{submitLabel}</Button></DialogFooter></form>; }
