'use client';

import React, { useEffect, useState } from 'react';
import type { Item, Receiving, Warehouse } from '@/lib/erp-types';
import { createReceiving, getDocumentNumberPreview, getReceivingAttachment, getReceivingData, getReceivingListPage, uploadReceivingAttachment } from '@/app/actions/erp-actions';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Plus, Search, FileText, UploadCloud, ShieldAlert, X, Download, Eye } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { can, warehouseForRole } from '@/lib/rbac';
import { TablePagination } from '@/components/shared/table-pagination';

type NewReceivingItem = {
  name: string;
  code: string;
  category: string;
  quantity: string;
  unit: string;
  reorderLevel: string;
  location: Warehouse;
};

const emptyItemForm: NewReceivingItem = {
  name: '',
  code: '',
  category: '',
  quantity: '1',
  unit: 'pcs',
  reorderLevel: '5',
  location: 'FARM',
};

const receivingMimeType = (file: File) => file.type || ({
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}[file.name.slice(file.name.lastIndexOf('.')).toLowerCase()] || '');

export default function ReceivingPage() {
  const { user } = useAuth();
  const [receivings, setReceivings] = useState<Receiving[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [listPage, setListPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [drNumber, setDrNumber] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [drFile, setDrFile] = useState<File | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [drInputKey, setDrInputKey] = useState(0);
  const [invoiceInputKey, setInvoiceInputKey] = useState(0);
  const [receivedItems, setReceivedItems] = useState<Array<NewReceivingItem & { quantityNumber: number; reorderLevelNumber: number }>>([]);
  const [newItem, setNewItem] = useState<NewReceivingItem>(emptyItemForm);
  const [receivingNumberPreview, setReceivingNumberPreview] = useState('');
  const [selectedReceiving, setSelectedReceiving] = useState<Receiving | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<{ url: string; name: string } | null>(null);
  const [uploadingAttachmentType, setUploadingAttachmentType] = useState<'DELIVERY_RECEIPT' | 'INVOICE' | null>(null);
  const [detailsInputKey, setDetailsInputKey] = useState(0);

  const canAccessReceiving = can(user?.role, 'receiving:view', user?.permissions);
  const canCreateReceiving = can(user?.role, 'receiving:create', user?.permissions);
  const canUploadReceivingAttachments = can(user?.role, 'receiving:attachments:upload', user?.permissions);
  const receivingWarehouse: Warehouse = warehouseForRole(user?.role) || 'FARM';

  useEffect(() => {
    setDrFile(null);
    setInvoiceFile(null);
    setDrInputKey(key => key + 1);
    setInvoiceInputKey(key => key + 1);
  }, [isCreateOpen]);

  useEffect(() => {
    if (!user?.id || !canAccessReceiving) return;
    void getReceivingData(user.id)
      .then(data => {
        setItems(data.items);
      })
      .catch(() => {
        toast({ title: 'Unable to load receiving reports', description: 'Database operation failed.', variant: 'destructive' });
      });
  }, [canAccessReceiving, user?.id]);

  useEffect(() => {
    if (!user?.id || !canAccessReceiving) return;
    getReceivingListPage({ page: listPage, search: searchQuery }, user.id)
      .then(result => { setReceivings(result.rows); setListTotal(result.total); })
      .catch(error => toast({ title: 'Unable to load receiving reports', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }));
  }, [canAccessReceiving, listPage, searchQuery, user?.id]);

  useEffect(() => {
    if (!user?.id || !canCreateReceiving) return;
    getDocumentNumberPreview('RECEIVING', user.id)
      .then(setReceivingNumberPreview)
      .catch(error => toast({ title: 'Unable to load Receiving Report number', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }));
  }, [canCreateReceiving, user?.id]);

  const handleAddItem = () => {
    const trimmedName = newItem.name.trim();
    const trimmedCode = newItem.code.trim();
    const trimmedCategory = newItem.category.trim();
    const trimmedUnit = newItem.unit.trim();
    const quantity = Number(newItem.quantity);
    const reorderLevel = Number(newItem.reorderLevel);

    if (!trimmedName || !trimmedCode || !trimmedCategory || !trimmedUnit) {
      toast({ title: 'Missing item details', description: 'Item name, code, category, and unit are required.', variant: 'destructive' });
      return;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast({ title: 'Invalid quantity', description: 'Quantity must be a positive number.', variant: 'destructive' });
      return;
    }

    if (!Number.isFinite(reorderLevel) || reorderLevel < 0) {
      toast({ title: 'Invalid reorder level', description: 'Reorder level must be zero or greater.', variant: 'destructive' });
      return;
    }

    const duplicate = receivedItems.some(item => item.code.toLowerCase() === trimmedCode.toLowerCase());
    if (duplicate) {
      toast({ title: 'Duplicate item', description: 'This item code is already added to this receiving report.', variant: 'destructive' });
      return;
    }

    setReceivedItems([
      ...receivedItems,
      {
        ...newItem,
        name: trimmedName,
        code: trimmedCode,
        category: trimmedCategory,
        unit: trimmedUnit,
        location: receivingWarehouse,
        quantity: String(quantity),
        reorderLevel: String(reorderLevel),
        quantityNumber: quantity,
        reorderLevelNumber: reorderLevel,
      },
    ]);
    setNewItem(emptyItemForm);
  };

  const handleRemoveItem = (index: number) => {
    setReceivedItems(receivedItems.filter((_, i) => i !== index));
  };

  const selectDocumentFile = (
    event: React.ChangeEvent<HTMLInputElement>,
    setFile: React.Dispatch<React.SetStateAction<File | null>>,
    resetInput: React.Dispatch<React.SetStateAction<number>>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg'];
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    const mimeType = receivingMimeType(file);
    if (!allowedTypes.includes(mimeType)) {
      toast({ title: 'Unsupported file type', description: 'Choose a PDF, PNG, or JPG file.', variant: 'destructive' });
      setFile(null);
      resetInput(key => key + 1);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'File is too large', description: 'Choose a file no larger than 5 MB.', variant: 'destructive' });
      setFile(null);
      resetInput(key => key + 1);
      return;
    }
    setFile(file);
  };

  const removeDocumentFile = (
    setFile: React.Dispatch<React.SetStateAction<File | null>>,
    resetInput: React.Dispatch<React.SetStateAction<number>>,
  ) => {
    setFile(null);
    resetInput(key => key + 1);
  };

  const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Unable to read the selected attachment.'));
        return;
      }
      resolve(reader.result.split(',')[1] || '');
    };
    reader.onerror = () => reject(reader.error || new Error('Unable to read the selected attachment.'));
    reader.readAsDataURL(file);
  });

  const handleAttachment = async (receiving: Receiving, type: 'DELIVERY_RECEIPT' | 'INVOICE', mode: 'view' | 'download') => {
    if (!user?.id) return;
    try {
      const attachment = await getReceivingAttachment({ receivingId: receiving.id, type, userId: user.id });
      const url = `data:${attachment.mimeType};base64,${attachment.dataBase64}`;
      if (mode === 'view') {
        setPreviewAttachment({ url, name: attachment.fileName });
        return;
      }
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.fileName;
      link.click();
    } catch (error) {
      toast({ title: 'Unable to open attachment', description: error instanceof Error ? error.message : 'The attachment could not be retrieved.', variant: 'destructive' });
    }
  };

  const handleUploadAttachment = async (event: React.ChangeEvent<HTMLInputElement>, type: 'DELIVERY_RECEIPT' | 'INVOICE') => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file || !selectedReceiving || !user?.id) return;

    const mimeType = receivingMimeType(file);
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(mimeType)) {
      toast({ title: 'Unsupported file type', description: 'Choose a PDF, PNG, or JPG file.', variant: 'destructive' });
      return;
    }
    if (file.size <= 0 || file.size > 5 * 1024 * 1024) {
      toast({ title: 'Invalid file size', description: 'Choose a non-empty file no larger than 5 MB.', variant: 'destructive' });
      return;
    }

    setUploadingAttachmentType(type);
    try {
      const attachment = await uploadReceivingAttachment({
        receivingId: selectedReceiving.id,
        type,
        userId: user.id,
        file: { fileName: file.name, mimeType, dataBase64: await fileToBase64(file) },
      });
      const updateReceiving = (receiving: Receiving): Receiving => receiving.id !== selectedReceiving.id
        ? receiving
        : {
            ...receiving,
            drFileUrl: type === 'DELIVERY_RECEIPT' ? attachment.fileName : receiving.drFileUrl,
            invoiceFileUrl: type === 'INVOICE' ? attachment.fileName : receiving.invoiceFileUrl,
            attachments: [...(receiving.attachments || []).filter(existing => existing.type !== type), attachment],
          };
      setSelectedReceiving(current => current ? updateReceiving(current) : current);
      setReceivings(current => current.map(updateReceiving));
      setDetailsInputKey(key => key + 1);
      toast({ title: 'Attachment uploaded', description: `${type === 'DELIVERY_RECEIPT' ? 'Delivery Receipt' : 'Invoice'} was linked to ${selectedReceiving.rrNumber}.` });
    } catch (error) {
      toast({ title: 'Unable to upload attachment', description: error instanceof Error ? error.message : 'The file could not be saved.', variant: 'destructive' });
    } finally {
      setUploadingAttachmentType(null);
    }
  };

  const handleCreateReceiving = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canCreateReceiving) {
      toast({ title: 'Access denied', description: 'Only farm staff, engineering staff, approvers, and admins can create receiving reports.', variant: 'destructive' });
      return;
    }

    if (!drNumber.trim() || !invoiceNumber.trim() || receivedItems.length === 0) {
      toast({ title: 'Missing fields', description: 'Please enter the DR and invoice numbers and add at least one item.', variant: 'destructive' });
      return;
    }

    try {
      const rrNumber = await createReceiving({
        drNumber: drNumber.trim(),
        invoiceNumber: invoiceNumber.trim(),
        warehouse: receivingWarehouse,
        receivedBy: user?.name || 'Warehouse Staff',
        userId: user?.id || '',
        drFile: drFile ? { fileName: drFile.name, mimeType: receivingMimeType(drFile), dataBase64: await fileToBase64(drFile) } : undefined,
        invoiceFile: invoiceFile ? { fileName: invoiceFile.name, mimeType: receivingMimeType(invoiceFile), dataBase64: await fileToBase64(invoiceFile) } : undefined,
        items: receivedItems.map(item => ({
          itemCode: item.code,
          itemName: item.name,
          category: item.category,
          quantity: item.quantityNumber,
          unit: item.unit,
          reorderLevel: item.reorderLevelNumber,
        })),
      });

      toast({
        title: 'Receiving Report Created',
        description: `Items were received and stocked in ${receivingWarehouse === 'FARM' ? 'Farm' : 'Engineering'} Warehouse under ${rrNumber}.`,
      });

      setIsCreateOpen(false);
      setReceivedItems([]);
      setNewItem(emptyItemForm);
      setDrNumber('');
      setInvoiceNumber('');
      setDrFile(null);
      setInvoiceFile(null);
      if (user?.id) {
        void getDocumentNumberPreview('RECEIVING', user.id).then(setReceivingNumberPreview)
          .catch(error => toast({ title: 'Unable to refresh Receiving Report number', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }));
      }

      const data = await getReceivingData(user?.id || '');
      setItems(data.items);
      const pageData = await getReceivingListPage({ page: listPage, search: searchQuery }, user?.id || '');
      setReceivings(pageData.rows);
      setListTotal(pageData.total);
    } catch (error) {
      toast({
        title: 'Unable to create receiving report',
        description: error instanceof Error ? error.message : 'Database operation failed.',
        variant: 'destructive',
      });
    }
  };

  const filteredReceivings = receivings;

  if (!canAccessReceiving) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900 shadow-sm">
        <h1 className="text-xl font-bold">Access Restricted</h1>
        <p className="mt-2 text-sm">Receiving Reports are available to authorized warehouse staff, Approvers, Accounting, and Admin users.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-600">Receiving report</p>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Receiving Reports (RR)</h1>
          <p className="mt-1 text-sm text-neutral-500">Record incoming stock and add new or existing items to the Farm Warehouse.</p>
        </div>

        {canCreateReceiving && <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2">
              <Plus className="h-4 w-4" /> New Receiving Report
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Receiving Report</DialogTitle>
              <DialogDescription>Items are recorded into the selected warehouse and any matching item code is updated or reused automatically.</DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateReceiving} className="space-y-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Receiving Report Number (System Generated)</label>
                  <Input value={receivingNumberPreview || 'Loading series...'} readOnly className="border-emerald-200 bg-emerald-50 font-mono font-semibold text-emerald-800" />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Delivery Receipt (DR) Number</label>
                  <Input placeholder="e.g., DR-99821" value={drNumber} onChange={e => setDrNumber(e.target.value)} required />
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Invoice Number</label>
                  <Input placeholder="e.g., INV-2025-88" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} required />
                </div>

                <div className="space-y-2 md:col-span-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  <div className="flex items-center gap-2 font-semibold">
                    <ShieldAlert className="h-4 w-4" />
                    {receivingWarehouse === 'FARM' ? 'Farm Warehouse' : 'Engineering Warehouse'} selected for receiving entries
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 border-t border-neutral-200 pt-4 md:grid-cols-2">
                <div className="rounded-xl border-2 border-dashed border-neutral-200 p-4 text-center transition-colors hover:bg-neutral-50">
                  <input
                    key={drInputKey}
                    id="receiving-dr-file"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                    className="sr-only"
                    onChange={event => selectDocumentFile(event, setDrFile, setDrInputKey)}
                  />
                  <label htmlFor="receiving-dr-file" className="block cursor-pointer">
                    <UploadCloud className="mx-auto mb-2 h-8 w-8 text-neutral-400" />
                    <p className="text-xs font-semibold text-neutral-700">{drFile ? drFile.name : 'Upload Delivery Receipt (DR)'}</p>
                    <p className="mt-1 text-[10px] text-neutral-400">PDF, PNG, JPG up to 5MB</p>
                  </label>
                  {drFile && <div className="mt-2 flex items-center justify-center gap-2"><Badge className="bg-emerald-600 text-white">DR Uploaded ✓</Badge><Button type="button" variant="ghost" size="icon" aria-label="Remove Delivery Receipt file" onClick={() => removeDocumentFile(setDrFile, setDrInputKey)}><X className="h-4 w-4" /></Button></div>}
                </div>

                <div className="rounded-xl border-2 border-dashed border-neutral-200 p-4 text-center transition-colors hover:bg-neutral-50">
                  <input
                    key={invoiceInputKey}
                    id="receiving-invoice-file"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                    className="sr-only"
                    onChange={event => selectDocumentFile(event, setInvoiceFile, setInvoiceInputKey)}
                  />
                  <label htmlFor="receiving-invoice-file" className="block cursor-pointer">
                    <UploadCloud className="mx-auto mb-2 h-8 w-8 text-neutral-400" />
                    <p className="text-xs font-semibold text-neutral-700">{invoiceFile ? invoiceFile.name : 'Upload Invoice'}</p>
                    <p className="mt-1 text-[10px] text-neutral-400">PDF, PNG, JPG up to 5MB</p>
                  </label>
                  {invoiceFile && <div className="mt-2 flex items-center justify-center gap-2"><Badge className="bg-emerald-600 text-white">Invoice Uploaded ✓</Badge><Button type="button" variant="ghost" size="icon" aria-label="Remove Invoice file" onClick={() => removeDocumentFile(setInvoiceFile, setInvoiceInputKey)}><X className="h-4 w-4" /></Button></div>}
                </div>
              </div>

              <div className="border-t border-neutral-200 pt-4 space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-neutral-700">Items received</h3>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-7">
                  <div className="xl:col-span-2 space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">Item Name *</label>
                    <Input value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })} placeholder="e.g., Water Pump" />
                  </div>

                  <div className="xl:col-span-2 space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">Item Code / Part Code *</label>
                    <Input value={newItem.code} onChange={e => setNewItem({ ...newItem, code: e.target.value })} placeholder="e.g., WP-1001" />
                  </div>

                  <div className="xl:col-span-1 space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">Category *</label>
                    <Input value={newItem.category} onChange={e => setNewItem({ ...newItem, category: e.target.value })} placeholder="Pump" />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">Quantity *</label>
                    <Input type="number" min="1" step="any" value={newItem.quantity} onChange={e => setNewItem({ ...newItem, quantity: e.target.value })} />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">Unit *</label>
                    <Input value={newItem.unit} onChange={e => setNewItem({ ...newItem, unit: e.target.value })} placeholder="pcs" />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">Reorder Level *</label>
                    <Input type="number" min="0" step="any" value={newItem.reorderLevel} onChange={e => setNewItem({ ...newItem, reorderLevel: e.target.value })} />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">Location</label>
                    <Input value={receivingWarehouse === 'FARM' ? 'Farm Warehouse' : 'Engineering Warehouse'} readOnly className="bg-neutral-100 text-neutral-700" />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="button" onClick={handleAddItem} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    Add Item
                  </Button>
                </div>

                {receivedItems.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item Code</TableHead>
                        <TableHead>Item Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {receivedItems.map((item, index) => (
                        <TableRow key={`${item.code}-${index}`}>
                          <TableCell className="font-medium">{item.code}</TableCell>
                          <TableCell>{item.name}</TableCell>
                          <TableCell>{item.category}</TableCell>
                          <TableCell className="text-right">{item.quantityNumber}</TableCell>
                          <TableCell>{item.unit}</TableCell>
                          <TableCell>{item.location === 'FARM' ? 'Farm Warehouse' : 'Engineering Warehouse'}</TableCell>
                          <TableCell className="text-right">
                            <Button type="button" variant="ghost" size="sm" className="text-red-500 hover:text-red-700" onClick={() => handleRemoveItem(index)}>
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white">Submit Receiving Report</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-1 items-center gap-3">
          <Search className="h-5 w-5 text-neutral-400" />
          <Input
            placeholder="Search by RR Number, DR, or Invoice..."
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setListPage(1); }}
            className="border-none shadow-none focus-visible:ring-0"
          />
        </div>
        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">Farm Warehouse</Badge>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>RR Number</TableHead>
                <TableHead>DR Number</TableHead>
                <TableHead>Invoice Number</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Received By</TableHead>
                <TableHead>Date Received</TableHead>
                <TableHead>Attachments / Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReceivings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-neutral-400">
                    No receiving reports recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                filteredReceivings.map(rr => (
                  <TableRow key={rr.id}>
                    <TableCell>
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto p-0 font-bold text-emerald-700"
                        onClick={() => { setSelectedReceiving(rr); setPreviewAttachment(null); }}
                      >
                        {rr.rrNumber}
                      </Button>
                    </TableCell>
                    <TableCell>{rr.drNumber}</TableCell>
                    <TableCell>{rr.invoiceNumber}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn('font-semibold', rr.warehouse === 'FARM' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
                        {rr.warehouse}
                      </Badge>
                    </TableCell>
                    <TableCell>{rr.receivedBy}</TableCell>
                    <TableCell>{rr.receivedDate}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-neutral-600">{rr.attachments?.length ? `${rr.attachments.length} file(s)` : 'No stored files'}</span>
                        <Button variant="outline" size="sm" onClick={() => { setSelectedReceiving(rr); setPreviewAttachment(null); }}>View Details</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
        <TablePagination page={listPage} pageSize={20} total={listTotal} onPageChange={setListPage} />
      </Card>
      <Dialog open={Boolean(selectedReceiving)} onOpenChange={open => { if (!open) { setSelectedReceiving(null); setPreviewAttachment(null); } }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Receiving Report {selectedReceiving?.rrNumber}</DialogTitle>
            <DialogDescription>Document details and read-only attachment access.</DialogDescription>
          </DialogHeader>
          {selectedReceiving && <div className="space-y-5">
            <dl className="grid gap-3 rounded-lg border bg-neutral-50 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-neutral-500">RR Number</dt><dd className="font-mono font-semibold text-emerald-800">{selectedReceiving.rrNumber}</dd></div>
              <div><dt className="text-neutral-500">Delivery Receipt</dt><dd className="font-medium">{selectedReceiving.drNumber}</dd></div>
              <div><dt className="text-neutral-500">Invoice</dt><dd className="font-medium">{selectedReceiving.invoiceNumber}</dd></div>
              <div><dt className="text-neutral-500">Warehouse</dt><dd className="font-medium">{selectedReceiving.warehouse === 'FARM' ? 'Farm Warehouse' : 'Engineering Warehouse'}</dd></div>
              <div><dt className="text-neutral-500">Received By</dt><dd className="font-medium">{selectedReceiving.receivedBy}</dd></div>
              <div><dt className="text-neutral-500">Date Received</dt><dd className="font-medium">{new Date(`${selectedReceiving.receivedDate}T00:00:00`).toLocaleDateString()}</dd></div>
            </dl>
            <div>
              <h3 className="mb-2 font-semibold">Items received</h3>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader><TableRow><TableHead>Item Name</TableHead><TableHead>Item Code / Part Code</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Reorder Level</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {selectedReceiving.items?.length ? selectedReceiving.items.map(item => <TableRow key={item.id}><TableCell className="font-medium">{item.item?.name || 'Unknown item'}</TableCell><TableCell className="font-mono">{item.item?.code || item.itemId}</TableCell><TableCell>{item.category}</TableCell><TableCell className="text-right">{item.qtyReceived}</TableCell><TableCell>{item.item?.unit || '-'}</TableCell><TableCell className="text-right">{item.reorderLevel}</TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-neutral-500">No items were recorded for this receiving report.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div>
              <h3 className="mb-2 font-semibold">Attachments</h3>
              <div className="space-y-2">
                {(['DELIVERY_RECEIPT', 'INVOICE'] as const).map(type => {
                  const attachment = selectedReceiving.attachments?.find(file => file.type === type);
                  const legacyFileName = type === 'DELIVERY_RECEIPT' ? selectedReceiving.drFileUrl : selectedReceiving.invoiceFileUrl;
                  const label = type === 'DELIVERY_RECEIPT' ? 'Delivery Receipt (DR)' : 'Invoice';
                  return <div key={type} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                    <div className="flex items-center gap-2 text-sm"><FileText className="h-4 w-4 text-emerald-700" /><span className="font-medium">{label}</span><span className="text-neutral-500">{attachment?.fileName || (legacyFileName ? `${legacyFileName} (legacy record; file unavailable)` : 'Not uploaded')}</span></div>
                    {attachment ? <div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => void handleAttachment(selectedReceiving, type, 'view')}><Eye className="mr-1 h-4 w-4" />View</Button><Button type="button" variant="outline" size="sm" onClick={() => void handleAttachment(selectedReceiving, type, 'download')}><Download className="mr-1 h-4 w-4" />Download</Button></div> : canUploadReceivingAttachments ? <div className="flex items-center gap-2">
                      <input
                        key={`${type}-${detailsInputKey}`}
                        id={`receiving-details-upload-${type}`}
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                        className="sr-only"
                        disabled={uploadingAttachmentType !== null}
                        onChange={event => void handleUploadAttachment(event, type)}
                      />
                      <Button type="button" variant="outline" size="sm" disabled={uploadingAttachmentType !== null} asChild>
                        <label htmlFor={`receiving-details-upload-${type}`} className="cursor-pointer">
                          <UploadCloud className="mr-1 h-4 w-4" />
                          {uploadingAttachmentType === type ? 'Uploading...' : `Upload ${type === 'DELIVERY_RECEIPT' ? 'DR' : 'Invoice'}`}
                        </label>
                      </Button>
                    </div> : <span className="text-xs text-neutral-500">Not uploaded</span>}
                  </div>;
                })}
              </div>
            </div>
            {previewAttachment && <div className="space-y-2"><p className="text-sm font-medium">{previewAttachment.name}</p><iframe title={`Preview ${previewAttachment.name}`} src={previewAttachment.url} className="h-[60vh] w-full rounded-md border" /></div>}
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
