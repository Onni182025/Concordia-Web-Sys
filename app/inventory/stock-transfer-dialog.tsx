'use client';

import { useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2, ArrowRightLeft } from 'lucide-react';
import type { Item, Warehouse, WarehouseStock } from '@/lib/erp-types';
import { createStockTransfer } from '@/app/actions/erp-actions';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

const transferItemSchema = z.object({
  itemId: z.string().min(1, 'Select an item'),
  search: z.string().min(1, 'Select an item'),
  quantity: z.coerce.number().positive('Enter a quantity greater than zero'),
  unit: z.string().min(1),
});

const transferSchema = z.object({
  transferNo: z.string().trim().min(1, 'Transfer number is required'),
  mrsNo: z.string().optional(), prPoNo: z.string().optional(), mirrNo: z.string().optional(),
  transferredFrom: z.enum(['FARM', 'ENGINEERING']), transferredTo: z.enum(['FARM', 'ENGINEERING']),
  dateTransferred: z.string().min(1, 'Transfer date is required'), modeOfTransport: z.string().optional(),
  items: z.array(transferItemSchema).min(1, 'Add at least one material'),
}).superRefine((value, context) => {
  if (value.transferredFrom === value.transferredTo) context.addIssue({ code: 'custom', path: ['transferredTo'], message: 'Destination must differ from source' });
});

type TransferForm = z.infer<typeof transferSchema>;

type Props = { items: Item[]; stocks: WarehouseStock[]; performedBy: string; userId: string; restrictedSource?: Warehouse | null; onSuccess: () => Promise<void> };

export default function StockTransferDialog({ items, stocks, performedBy, userId, restrictedSource, onSuccess }: Props) {
  const [open, setOpen] = useState(false);
  const form = useForm<TransferForm>({ resolver: zodResolver(transferSchema), defaultValues: { transferNo: '', mrsNo: '', prPoNo: '', mirrNo: '', transferredFrom: restrictedSource || 'ENGINEERING', transferredTo: restrictedSource === 'FARM' ? 'ENGINEERING' : 'FARM', dateTransferred: new Date().toISOString().slice(0, 10), modeOfTransport: '', items: [emptyLine()] } });
  const { fields, append, remove, replace } = useFieldArray({ control: form.control, name: 'items' });
  const source = form.watch('transferredFrom');
  const availableSourceItems = useMemo(() => items.filter(item =>
    stocks.some(stock => stock.itemId === item.id && stock.warehouse === source && stock.quantity > 0),
  ), [items, source, stocks]);

  const selectItem = (index: number, value: string) => {
    const normalized = value.trim().toLowerCase();
    const item = availableSourceItems.find(entry =>
      entry.id === value
      || entry.code.toLowerCase() === normalized
      || entry.name.toLowerCase() === normalized
      || `${entry.code} - ${entry.name}`.toLowerCase() === normalized,
    );
    if (!item) {
      form.setValue(`items.${index}.itemId`, '', { shouldValidate: true });
      form.setValue(`items.${index}.unit`, '');
      return;
    }
    form.setValue(`items.${index}.itemId`, item.id, { shouldValidate: true });
    form.setValue(`items.${index}.search`, `${item.code} - ${item.name}`, { shouldValidate: true });
    form.setValue(`items.${index}.unit`, item.unit);
  };

  const available = (itemId: string) => Number(stocks.find(stock => stock.itemId === itemId && stock.warehouse === source)?.quantity || 0);
  const changeSource = (value: string) => {
    const nextSource = value as Warehouse;
    if (nextSource === source) return;
    form.setValue('transferredFrom', nextSource, { shouldValidate: true });
    replace(fields.map(() => emptyLine()));
  };
  const submit = async (values: TransferForm) => {
    try {
      for (const line of values.items) if (line.quantity > available(line.itemId)) throw new Error(`Insufficient source stock for ${line.search}. Available: ${available(line.itemId)} ${line.unit}.`);
      await createStockTransfer({ ...values, performedBy, userId, items: values.items.map(({ search: _search, ...item }) => item) });
      toast({ title: 'Stock transfer recorded', description: `${values.transferNo} moved ${values.items.length} material line(s).` });
      await onSuccess(); setOpen(false); form.reset({ ...form.getValues(), transferNo: '', items: [emptyLine()] });
    } catch (error) { toast({ title: 'Unable to record stock transfer', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }); }
  };

  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button className="border border-emerald-600 bg-white text-emerald-700 hover:bg-emerald-50"><ArrowRightLeft className="mr-2 h-4 w-4" />Stock Transfer</Button></DialogTrigger><DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto"><DialogHeader><DialogTitle>Stock Transfer Slip</DialogTitle><DialogDescription>Move materials between Farm and Engineering warehouses with a complete audit trail.</DialogDescription></DialogHeader><form onSubmit={form.handleSubmit(submit)} className="space-y-6">
    <section className="grid gap-4 rounded-lg border bg-neutral-50 p-4 md:grid-cols-3"><Field label="Transfer No. *"><Input {...form.register('transferNo')} placeholder="TS-2026-0001" /></Field><Field label="MRS No."><Input {...form.register('mrsNo')} /></Field><Field label="PR / PO No."><Input {...form.register('prPoNo')} /></Field><Field label="MIRR No."><Input {...form.register('mirrNo')} /></Field><Field label="Transferred From *"><Select value={source} onValueChange={changeSource} disabled={Boolean(restrictedSource)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(!restrictedSource || restrictedSource === 'FARM') && <SelectItem value="FARM">Farm Warehouse</SelectItem>}{(!restrictedSource || restrictedSource === 'ENGINEERING') && <SelectItem value="ENGINEERING">Engineering Warehouse</SelectItem>}</SelectContent></Select></Field><Field label="Transferred To *"><Select value={form.watch('transferredTo')} onValueChange={value => form.setValue('transferredTo', value as Warehouse)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="FARM">Farm Warehouse</SelectItem><SelectItem value="ENGINEERING">Engineering Warehouse</SelectItem></SelectContent></Select></Field><Field label="Date Transferred *"><Input type="date" {...form.register('dateTransferred')} /></Field><Field label="Mode of Transport / Hauled By" className="md:col-span-2"><Input {...form.register('modeOfTransport')} /></Field></section>
    <section className="space-y-3"><div className="flex items-center justify-between"><div><h3 className="font-semibold">Materials Transferred</h3><p className="text-xs text-neutral-500">Only items with available stock in the selected source warehouse are listed. Changing warehouses clears selected items.</p></div><Button type="button" variant="outline" onClick={() => append(emptyLine())}><Plus className="mr-2 h-4 w-4" />Add Material</Button></div><div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[780px] text-sm"><thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500"><tr><th className="p-3">Item Search</th><th className="p-3">Item Code / Part Code</th><th className="p-3">Available</th><th className="p-3">Qty Transferred *</th><th className="p-3">Unit</th><th /></tr></thead><tbody>{fields.map((field, index) => { const itemId = form.watch(`items.${index}.itemId`); const unit = form.watch(`items.${index}.unit`); const selectedItem = availableSourceItems.find(item => item.id === itemId); return <tr key={field.id} className="border-t align-top"><td className="p-2"><Input list={`transfer-items-${index}`} {...form.register(`items.${index}.search`)} onChange={event => { form.register(`items.${index}.search`).onChange(event); selectItem(index, event.target.value); }} placeholder={availableSourceItems.length ? 'Search code or name' : 'No items in stock at this warehouse'} /><input type="hidden" {...form.register(`items.${index}.itemId`)} /><datalist id={`transfer-items-${index}`}>{availableSourceItems.map(item => <option key={item.id} value={`${item.code} - ${item.name}`} />)}</datalist></td><td className="p-2 pt-5 font-mono text-xs text-neutral-700">{selectedItem?.code || '-'}</td><td className="p-2 pt-5 font-semibold text-emerald-700">{available(itemId)} {unit}</td><td className="p-2"><Input type="number" min="0.001" max={available(itemId)} step="any" {...form.register(`items.${index}.quantity`)} /></td><td className="p-2 pt-5">{unit || '-'}</td><td className="p-2"><Button type="button" variant="ghost" size="icon" disabled={fields.length === 1} onClick={() => remove(index)}><Trash2 className="h-4 w-4 text-red-600" /></Button></td></tr>; })}</tbody></table></div></section>
    <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Saving...' : 'Record Stock Transfer'}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}

function emptyLine() { return { itemId: '', search: '', quantity: 0, unit: '' }; }
function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) { return <div className={`space-y-1.5 ${className}`}><Label className="text-xs font-semibold uppercase tracking-wide text-neutral-600">{label}</Label>{children}</div>; }
