'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardList, Loader2, Package, Plus, Trash2, UserCheck } from 'lucide-react';
import type { Item, WarehouseStock } from '@/lib/erp-types';
import { createMRS, getDocumentNumberPreview, getMRSFormData } from '@/app/actions/erp-actions';
import { useAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { mrsFormSchema, MRSFormValues } from '@/lib/schemas/mrs-schema';
import { can } from '@/lib/rbac';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export default function NewMRSPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [stocks, setStocks] = useState<WarehouseStock[]>([]);
  const [workOrders, setWorkOrders] = useState<Awaited<ReturnType<typeof getMRSFormData>>['workOrders']>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mrsNumberPreview, setMRSNumberPreview] = useState('');
  const today = new Date().toISOString().split('T')[0];

  const { register, control, handleSubmit, setValue, setError, watch, formState: { errors } } = useForm<MRSFormValues>({
    resolver: zodResolver(mrsFormSchema),
    defaultValues: {
      dateRequested: today,
      dateNeeded: '',
      department: user?.department || '',
      requestedBy: user?.name || '',
      purposeCategory: '',
      workOrderReference: '',
      workOrderId: '',
      preparedBy: user?.name || '',
      items: [{ isFreeText: false, itemId: '', customItemName: '', description: '', quantityRequested: 1, unit: 'pcs', purpose: '', currentStock: 0, notInInventory: false }],
    },
  });
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'items' });
  const watchedItems = watch('items');
  const workOrderReference = watch('workOrderReference');
  const workOrderId = searchParams.get('workOrderId');
  const linkedWorkOrder = workOrders.find(order => order.woNumber.toLowerCase() === (workOrderReference || '').trim().toLowerCase());
  const activeWorkOrders = workOrders.filter(order => !['COMPLETED', 'REJECTED'].includes(order.status));
  const workOrderSuggestions = activeWorkOrders.filter(order => `${order.woNumber} ${order.requestedBy} ${order.department} ${order.machineEquipment}`.toLowerCase().includes((workOrderReference || '').trim().toLowerCase())).slice(0, 6);

  useEffect(() => {
    if (!user?.id || !can(user.role, 'mrs:create', user.permissions)) return;
    getMRSFormData(user.id).then(data => { setItems(data.items); setStocks(data.stocks); setWorkOrders(data.workOrders); }).catch(error => setErrorMessage(error instanceof Error ? error.message : 'Unable to load requisition data from the database.'));
  }, [user?.id, user?.role, user?.permissions]);
  useEffect(() => {
    if (!user?.id || !can(user.role, 'mrs:create', user.permissions)) return;
    getDocumentNumberPreview('MRS', user.id)
      .then(setMRSNumberPreview)
      .catch(error => setErrorMessage(error instanceof Error ? error.message : 'Unable to load MRS number series.'));
  }, [user?.id, user?.role, user?.permissions]);
  useEffect(() => {
    if (!workOrderId) {
      setValue('workOrderId', linkedWorkOrder?.id || '');
      return;
    }
    const order = workOrders.find(candidate => candidate.id === workOrderId);
    if (!order) return;
    setValue('workOrderReference', order.woNumber);
    setValue('workOrderId', order.id);
    setValue('department', order.department);
    setValue('requestedBy', order.requestedBy);
    setValue('preparedBy', user?.name || order.requestedBy);
    setValue('dateNeeded', order.dateNeeded);
    setValue('purposeCategory', order.type === 'MRRF' ? 'REPAIR' : 'OTHER');
    const activeMRSItems = (order.mrsList || []).filter(mrs => mrs.status !== 'REJECTED').flatMap(mrs => mrs.items);
    const prefilledItems = (order.items || []).flatMap(orderItem => {
      const remaining = orderItem.quantityNeeded - activeMRSItems
        .filter(mrsItem => mrsItem.itemId === orderItem.itemId)
        .reduce((total, mrsItem) => total + mrsItem.quantityRequested, 0);
      if (remaining <= 0) return [];
      const item = items.find(candidate => candidate.id === orderItem.itemId);
      return [{
        isFreeText: false,
        itemId: orderItem.itemId,
        customItemName: item?.name || '',
        description: item?.description || '',
        quantityRequested: remaining,
        unit: item?.unit || 'pcs',
        purpose: order.description,
        currentStock: stocks.filter(stock => stock.itemId === orderItem.itemId).reduce((total, stock) => total + stock.quantity, 0),
        notInInventory: false,
      }];
    });
    replace(prefilledItems.length ? prefilledItems : [{ isFreeText: false, itemId: '', customItemName: '', description: '', quantityRequested: 1, unit: 'pcs', purpose: '', currentStock: 0, notInInventory: false }]);
  }, [items, linkedWorkOrder, replace, setValue, stocks, user?.name, workOrderId, workOrders]);

  if (user && !can(user.role, 'mrs:create', user.permissions)) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900"><h1 className="text-xl font-bold">Access Restricted</h1><p className="mt-2 text-sm">Your role can view requisitions but cannot create them.</p></div>;
  }

  const stockFor = (itemId: string) => stocks.filter(stock => stock.itemId === itemId).reduce((sum, stock) => sum + stock.quantity, 0);
  const findItem = (value: string) => items.find(item => item.id === value || item.code.toLowerCase() === value.toLowerCase() || item.name.toLowerCase() === value.toLowerCase());

  const chooseItem = (index: number, value: string) => {
    const item = findItem(value);
    if (item) {
      setValue(`items.${index}.itemId`, item.id, { shouldValidate: true });
      setValue(`items.${index}.customItemName`, item.name);
      setValue(`items.${index}.description`, item.description || '');
      setValue(`items.${index}.unit`, item.unit);
      setValue(`items.${index}.currentStock`, stockFor(item.id));
      setValue(`items.${index}.isFreeText`, false);
      setValue(`items.${index}.notInInventory`, false);
    } else {
      setValue(`items.${index}.itemId`, '');
      setValue(`items.${index}.customItemName`, value);
      setValue(`items.${index}.currentStock`, 0);
      setValue(`items.${index}.isFreeText`, true, { shouldValidate: true });
      setValue(`items.${index}.notInInventory`, Boolean(value.trim()), { shouldValidate: true });
    }
  };

  const submit = async (data: MRSFormValues) => {
    setIsSubmitting(true); setErrorMessage(null);
    try {
      if (!user?.id) throw new Error('You must be signed in.');
      const result = await createMRS({ ...data, createdById: user.id });
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      const created = result.mrs;
      toast({ title: 'MRS created', description: `${created.mrsNumber} is pending approval. ${created.items?.filter(item => item.notInInventory).length || 0} item(s) flagged for Purchasing.` });
      void getDocumentNumberPreview('MRS', user.id).then(setMRSNumberPreview)
        .catch(error => toast({ title: 'Unable to refresh MRS number', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }));
      router.push('/mrs');
    } catch (error) {
      if (process.env.NODE_ENV !== 'production' && error instanceof Error) console.error('[MRS form] Failed to save requisition:', error);
      setErrorMessage(error instanceof Error && process.env.NODE_ENV !== 'production'
        ? error.message
        : 'An unexpected error occurred while saving this requisition.');
    } finally { setIsSubmitting(false); }
  };

  return <div className="mx-auto max-w-5xl space-y-6 pb-12"><div><Button variant="ghost" onClick={() => router.push('/mrs')} className="-ml-2 mb-2 text-neutral-500"><ArrowLeft className="mr-1 h-4 w-4" />Back to Requisitions</Button><p className="text-sm font-semibold uppercase tracking-widest text-emerald-600">Materials workflow</p><h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-neutral-900"><ClipboardList className="h-7 w-7 text-emerald-600" />New Material Requisition Slip</h1><p className="mt-1 text-sm text-neutral-500">Create a request for stocked materials or route unavailable items to Purchasing.</p></div>
    {errorMessage && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Requisition could not be saved</AlertTitle><AlertDescription>{errorMessage}</AlertDescription></Alert>}
    <form onSubmit={handleSubmit(submit)} className="space-y-6"><Card><CardHeader><CardTitle>General Information</CardTitle><CardDescription>MRS numbers are generated from the configured series and reserved when the requisition is saved.</CardDescription></CardHeader><CardContent className="grid gap-5 md:grid-cols-2"><Field label="MRS Number (System Generated)"><Input value={mrsNumberPreview || 'Loading series...'} readOnly className="border-emerald-200 bg-emerald-50 font-mono font-semibold text-emerald-800" /></Field><Field label="Date Requested *" error={errors.dateRequested?.message}><Input type="date" {...register('dateRequested')} /></Field><Field label="Date Needed *" error={errors.dateNeeded?.message}><Input type="date" {...register('dateNeeded')} /></Field><Field label="Requesting Department *" error={errors.department?.message}><Input {...register('department')} placeholder="Engineering Maintenance" /></Field><Field label="Requested By *" error={errors.requestedBy?.message}><Input {...register('requestedBy')} placeholder="Full name" /></Field><Field label="MRWO / EPWO Reference No. (optional)"><Input list="active-work-orders" {...register('workOrderReference')} placeholder="Search or type a Job Order reference" /><datalist id="active-work-orders">{activeWorkOrders.map(order => <option key={order.id} value={order.woNumber}>{order.type} · {order.department} · {order.status}</option>)}</datalist>{!workOrderReference && workOrderSuggestions.length > 0 && <div className="mt-2 rounded-lg border bg-white p-2 shadow-sm"><p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Active Job Orders</p>{workOrderSuggestions.map(order => <button key={order.id} type="button" className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-emerald-50" onClick={() => setValue('workOrderReference', order.woNumber, { shouldValidate: true })}><span><span className="font-semibold text-emerald-700">{order.woNumber}</span><span className="ml-2 text-neutral-600">{order.machineEquipment}</span></span><Badge variant="outline" className="ml-2 shrink-0">{order.status}</Badge></button>)}</div>}{workOrderReference && linkedWorkOrder && <p className="text-xs text-emerald-700">Linked to {linkedWorkOrder.woNumber}: {linkedWorkOrder.description}</p>}{workOrderReference && !linkedWorkOrder && <p className="text-xs text-amber-700">No matching Job Order. Clear the reference or select a valid Job Order.</p>}</Field><Field label="Purpose Category *" error={errors.purposeCategory?.message}><Input {...register('purposeCategory')} placeholder="Repair, production supplies, project materials..." /></Field></CardContent></Card>
      <Card><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle className="flex items-center gap-2"><Package className="h-4 w-4 text-emerald-600" />Materials Needed</CardTitle><CardDescription>Search by item name or code. Unmatched entries are sent to Purchasing.</CardDescription></div><Button type="button" onClick={() => append({ isFreeText: false, itemId: '', customItemName: '', description: '', quantityRequested: 1, unit: 'pcs', purpose: '', currentStock: 0, notInInventory: false })} className="bg-emerald-600 text-white hover:bg-emerald-700"><Plus className="mr-1 h-4 w-4" />Add Material</Button></CardHeader><CardContent className="space-y-4">{fields.map((field, index) => { const line = watchedItems?.[index]; const isNotInInventory = Boolean(line?.notInInventory); const stock = line?.itemId ? stockFor(line.itemId) : 0; return <div key={field.id} className="space-y-4 rounded-xl border bg-neutral-50/70 p-4"><div className="flex items-center justify-between"><Badge variant="outline">Line {index + 1}</Badge>{fields.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)} className="text-red-600"><Trash2 className="mr-1 h-4 w-4" />Remove</Button>}</div><div className="grid gap-4 md:grid-cols-12"><div className="md:col-span-5"><Field label="Item (name or code) *" error={errors.items?.[index]?.customItemName?.message || errors.items?.[index]?.itemId?.message}><Input list="inventory-items" placeholder="Search inventory or type a new item" value={line?.itemId ? (items.find(item => item.id === line.itemId)?.name || '') : line?.customItemName || ''} onChange={event => chooseItem(index, event.target.value)} />{isNotInInventory ? <Badge className="mt-2 bg-amber-100 text-amber-800">Not in Inventory · Purchase Request</Badge> : line?.itemId ? <Badge className="mt-2 bg-emerald-100 text-emerald-800">Inventory item matched</Badge> : null}</Field></div><div className="md:col-span-2"><Field label="Quantity *" error={errors.items?.[index]?.quantityRequested?.message}><Input type="number" min="0.01" step="any" {...register(`items.${index}.quantityRequested`)} /></Field></div><div className="md:col-span-2"><Field label="Unit *" error={errors.items?.[index]?.unit?.message}><Input {...register(`items.${index}.unit`)} /></Field></div><div className="md:col-span-3"><Field label="In Stock?"><div className="flex h-10 items-center">{isNotInInventory ? <Badge className="bg-amber-100 text-amber-800">Purchase required</Badge> : line?.itemId ? <Badge className={stock > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}>{stock} {line.unit} available</Badge> : <span className="text-sm text-neutral-400">Choose an item</span>}</div></Field></div><div className="md:col-span-12"><Field label="Purpose / Remarks"><Textarea {...register(`items.${index}.purpose`)} placeholder="Where will this material be used?" /></Field></div></div></div>})}<datalist id="inventory-items">{items.flatMap(item => [<option key={`${item.id}-name`} value={item.name}>{item.code}</option>, <option key={`${item.id}-code`} value={item.code}>{item.name}</option>])}</datalist></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><UserCheck className="h-4 w-4 text-emerald-600" />Prepared By</CardTitle></CardHeader><CardContent><Field label="Prepared By *" error={errors.preparedBy?.message}><Input {...register('preparedBy')} placeholder="Full name" className="max-w-md" /></Field></CardContent></Card>
      <div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => router.push('/mrs')} disabled={isSubmitting}>Cancel</Button><Button type="submit" disabled={isSubmitting} className="bg-emerald-600 px-6 text-white hover:bg-emerald-700">{isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : <><CheckCircle2 className="mr-2 h-4 w-4" />Create MRS</>}</Button></div>
    </form></div>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <div className="space-y-1.5"><label className="text-xs font-semibold uppercase tracking-wide text-neutral-600">{label}</label>{children}{error && <p className="text-xs text-red-600">{error}</p>}</div>; }
