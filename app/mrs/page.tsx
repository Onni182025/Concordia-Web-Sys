'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { MRS, Item, Warehouse } from '@/lib/erp-types';
import { approveMRS, cancelMRS, getMRSListPage, getMRSPageReferenceData, issueMRS } from '@/app/actions/erp-actions';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Search, ClipboardList, Plus } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { can, warehouseForRole } from '@/lib/rbac';
import { TablePagination } from '@/components/shared/table-pagination';

export default function MRSPage() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [mrsList, setMRSList] = useState<MRS[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [workOrders, setWorkOrders] = useState<Array<{ id: string; woNumber: string }>>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [listPage, setListPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [selectedMRS, setSelectedMRS] = useState<MRS | null>(null);
  const [openMRSId, setOpenMRSId] = useState<string | null>(null);
  const [issueWarehouse, setIssueWarehouse] = useState<Warehouse>('ENGINEERING');
  const [isIssuing, setIsIssuing] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const restrictedWarehouse: Warehouse | null = warehouseForRole(user?.role);

  useEffect(() => {
    if (!user?.id) return;
    getMRSPageReferenceData(user.id).then(data => { setItems(data.items); setWorkOrders(data.workOrders); }).catch(error => toast({ title: 'Unable to load requisition data', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    getMRSListPage({ page: listPage, search: searchQuery }, user.id)
      .then(result => { setMRSList(result.rows); setListTotal(result.total); })
      .catch(error => toast({ title: 'Unable to load requisitions', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }));
  }, [listPage, searchQuery, user?.id]);

  useEffect(() => {
    const mrsNumber = searchParams.get('mrsNumber');
    if (!mrsNumber || mrsList.length === 0) return;
    const requestedMRS = mrsList.find(mrs => mrs.mrsNumber === mrsNumber);
    if (!requestedMRS) return;
    setSearchQuery(mrsNumber);
    setSelectedMRS(requestedMRS);
    setOpenMRSId(requestedMRS.id);
  }, [mrsList, searchParams]);

  useEffect(() => {
    if (restrictedWarehouse) setIssueWarehouse(restrictedWarehouse);
  }, [restrictedWarehouse]);

  const handleApproveMRS = async (mrsId: string) => {
    try {
      if (!user || !can(user.role, 'mrs:approve', user.permissions)) throw new Error('You do not have permission to approve material requisitions.');
      const updated = await approveMRS(mrsId, user.id);
      setMRSList(current => current.map(mrs => mrs.id === mrsId ? updated : mrs));
      setSelectedMRS(updated);
      toast({ title: 'MRS Approved', description: 'The Material Requisition Slip has been approved.' });
    } catch (error) { toast({ title: 'Unable to approve MRS', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }); }
  };

  const handleIssueMRS = async (mrsId: string) => {
    if (isIssuing || !window.confirm('Issue this MRS and deduct the approved quantities from inventory?')) return;
    setIsIssuing(true);
    try {
      if (!user || !can(user.role, 'mrs:issue', user.permissions)) throw new Error('You do not have permission to issue material requisitions.');
      if (restrictedWarehouse && issueWarehouse !== restrictedWarehouse) throw new Error(`You can only issue from the ${restrictedWarehouse === 'ENGINEERING' ? 'Engineering' : 'Farm'} Warehouse.`);
      const updated = await issueMRS(mrsId, issueWarehouse, user.id);
      setMRSList(current => current.map(mrs => mrs.id === mrsId ? updated : mrs));
      setSelectedMRS(updated);
      toast({ title: 'MRS Issued', description: 'Stock was deducted and the Material Requisition Slip is now Issued.' });
    } catch (error) { toast({ title: 'Unable to issue MRS', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }); }
    finally { setIsIssuing(false); }
  };

  const handleCancelMRS = async () => {
    if (!selectedMRS || !user?.id) return;
    setIsCancelling(true);
    try {
      const updated = await cancelMRS(selectedMRS.id, cancelReason, user.id);
      setMRSList(current => current.map(mrs => mrs.id === updated.id ? updated : mrs));
      setSelectedMRS(updated);
      setCancelOpen(false);
      setCancelReason('');
      toast({ title: 'MRS Cancelled', description: `${updated.mrsNumber} was cancelled.` });
    } catch (error) {
      toast({ title: 'Unable to cancel MRS', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' });
    } finally {
      setIsCancelling(false);
    }
  };

  const filteredMRS = mrsList;
  const canCancelSelectedMRS = Boolean(
    selectedMRS &&
    selectedMRS.status !== 'REJECTED' &&
    selectedMRS.status !== 'ISSUED' &&
    selectedMRS.status !== 'FULFILLED' &&
    ((user?.role === 'SUPER_ADMIN' && (selectedMRS.status === 'PENDING' || selectedMRS.status === 'APPROVED')) ||
      (user?.id === selectedMRS.createdById && selectedMRS.status === 'PENDING')),
  );

  const handlePrintStockIssuanceSlip = (mrs: MRS) => {
    const issueWarehouseName = mrs.issuedWarehouse ? (mrs.issuedWarehouse === 'FARM' ? 'Farm Warehouse' : 'Engineering Warehouse') : (issueWarehouse === 'FARM' ? 'Farm Warehouse' : 'Engineering Warehouse');
    const issuedBy = mrs.issuedBy || user?.name || 'Warehouse Staff';
    const issuedAt = mrs.issuedAt ? new Date(mrs.issuedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const rows = (mrs.items || []).map((item, index) => {
      const resolvedItem = items.find(current => current.id === item.itemId);
      const itemName = resolvedItem?.name || item.customItemName || 'Custom Material';
      const itemCode = resolvedItem?.code || 'NON-STOCK';
      const unit = resolvedItem?.unit || item.unit || 'pcs';
      const quantity = item.quantityIssued > 0 ? item.quantityIssued : item.quantityApproved || item.quantityRequested;
      const remarks = item.purpose || item.description || '—';
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${itemCode}<br /><span>${itemName}</span></td>
          <td>${Number(quantity).toLocaleString()}</td>
          <td>${unit}</td>
          <td>${remarks}</td>
        </tr>
      `;
    }).join('');

    const printWindow = window.open('', '_blank', 'width=900,height=1200');
    if (!printWindow) {
      toast({ title: 'Print blocked', description: 'Please allow pop-ups to print the issuance slip.', variant: 'destructive' });
      return;
    }

    printWindow.document.write(`
      <html>
        <head>
          <title>Stock Issuance Slip - ${mrs.mrsNumber}</title>
          <style>
            :root { color-scheme: light; }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              font-family: Arial, Helvetica, sans-serif;
              background: #fff;
              color: #111827;
              padding: 24px;
            }
            .slip {
              width: 100%;
              max-width: 900px;
              margin: 0 auto;
              border: 2px solid #1f2937;
              padding: 18px 20px 12px;
            }
            .header {
              display: grid;
              grid-template-columns: 70px 1fr auto;
              align-items: center;
              gap: 14px;
              margin-bottom: 8px;
            }
            .logo {
              width: 60px;
              height: 60px;
              border-radius: 12px;
              display: flex;
              align-items: center;
              justify-content: center;
              background: #0f766e;
              color: white;
              font-size: 26px;
              font-weight: 700;
            }
            .company {
              font-size: 20px;
              font-weight: 700;
              letter-spacing: 0.04em;
              color: #14532d;
            }
            .title {
              text-align: center;
              font-size: 22px;
              font-weight: 700;
              letter-spacing: 0.08em;
              text-transform: uppercase;
              margin: 10px 0 18px;
              color: #111827;
            }
            .meta {
              display: grid;
              grid-template-columns: repeat(4, minmax(140px, 1fr));
              gap: 12px;
              border: 1px solid #d1d5db;
              padding: 12px;
              margin-bottom: 18px;
              background: #f9fafb;
            }
            .meta-item {
              display: flex;
              flex-direction: column;
              gap: 3px;
            }
            .label {
              font-size: 10px;
              text-transform: uppercase;
              letter-spacing: 0.08em;
              color: #6b7280;
            }
            .value {
              font-size: 14px;
              font-weight: 700;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 18px;
            }
            th, td {
              border: 1px solid #d1d5db;
              padding: 8px 10px;
              text-align: left;
              vertical-align: top;
              font-size: 12px;
            }
            th {
              background: #ecfdf5;
              color: #065f46;
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 0.08em;
            }
            td span {
              display: block;
              color: #374151;
              margin-top: 2px;
            }
            .signatures {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 28px;
              margin-top: 18px;
            }
            .signature-box {
              border-top: 2px solid #111827;
              padding-top: 8px;
              min-height: 80px;
              display: flex;
              flex-direction: column;
              justify-content: flex-end;
              font-size: 12px;
            }
            .signature-name {
              font-weight: 700;
              margin-top: 8px;
            }
            @media print {
              body { padding: 0; }
              .slip { border-width: 1px; page-break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="slip">
            <div class="header">
              <div class="logo">C</div>
              <div class="company">CONCORDIA AGRIBUSINESS CORPORATION</div>
              <div class="value" style="text-align:right; font-size:12px;">Warehouse: ${issueWarehouseName}</div>
            </div>
            <div class="title">Stock Issuance Slip</div>
            <div class="meta">
              <div class="meta-item"><div class="label">No.</div><div class="value">${mrs.mrsNumber}</div></div>
              <div class="meta-item"><div class="label">Date Issued</div><div class="value">${issuedAt}</div></div>
              <div class="meta-item"><div class="label">Issued to</div><div class="value">${mrs.department || mrs.requestedBy}</div></div>
              <div class="meta-item"><div class="label">SRS / MRS No.</div><div class="value">${mrs.mrsNumber}</div></div>
            </div>
            <table>
              <thead>
                <tr>
                  <th style="width: 60px;">Item No.</th>
                  <th>Item Description</th>
                  <th style="width: 80px;">Qty</th>
                  <th style="width: 80px;">Unit</th>
                  <th style="width: 190px;">Remarks</th>
                </tr>
              </thead>
              <tbody>
                ${rows || '<tr><td colspan="5">No issued items available.</td></tr>'}
              </tbody>
            </table>
            <div class="signatures">
              <div class="signature-box">
                <div>Issued by:</div>
                <div class="signature-name">${issuedBy}</div>
                <div style="margin-top: 12px; font-size: 11px; color: #4b5563;">Signature over printed name</div>
              </div>
              <div class="signature-box">
                <div>Received and acknowledged by:</div>
                <div class="signature-name">${mrs.requestedBy}</div>
                <div style="margin-top: 12px; font-size: 11px; color: #4b5563;">Signature over printed name / Date</div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Material Requisition Slips (MRS)</h1>
          <p className="text-sm text-neutral-500">Track, create, and approve material requisitions across departments</p>
        </div>

        {can(user?.role, 'mrs:create', user?.permissions) && <Link href="/mrs/new">
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-2">
            <Plus className="h-4 w-4" /> Create New MRS
          </Button>
        </Link>}
      </div>

      {/* Search & Filter */}
      <div className="flex items-center gap-3 bg-white p-4 rounded-xl border shadow-sm">
        <Search className="h-5 w-5 text-neutral-400" />
        <Input 
          placeholder="Search by MRS Number, Requester, or Department..." 
          value={searchQuery}
          onChange={e => { setSearchQuery(e.target.value); setListPage(1); }}
          className="border-none shadow-none focus-visible:ring-0"
        />
      </div>

      {/* MRS Table */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>MRS Number</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Linked Job Order</TableHead>
                <TableHead>Purpose Category</TableHead>
                <TableHead>Requested By</TableHead>
                <TableHead>Date Requested</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMRS.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-neutral-400">
                    No Material Requisition Slips found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredMRS.map((mrs) => {
                  const linkedWO = workOrders.find(w => w.id === mrs.workOrderId);
                  return (
                    <TableRow key={mrs.id}>
                      <TableCell className="font-bold text-emerald-700 font-mono">{mrs.mrsNumber}</TableCell>
                      <TableCell className="font-medium text-neutral-700">{mrs.department || 'Engineering'}</TableCell>
                      <TableCell className="font-semibold text-neutral-600">{linkedWO?.woNumber || 'N/A'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{mrs.purposeCategory}</Badge>
                      </TableCell>
                      <TableCell>{mrs.requestedBy}</TableCell>
                      <TableCell>{mrs.dateRequested || mrs.createdAt}</TableCell>
                      <TableCell>
                        <Badge 
                          className={cn(
                            "font-semibold",
                            mrs.status === 'PENDING' ? "bg-amber-500 text-white" :
                            mrs.status === 'APPROVED' ? "bg-blue-500 text-white" :
                            (mrs.status === 'ISSUED' || mrs.status === 'FULFILLED') ? "bg-emerald-600 text-white" :
                            mrs.status === 'REJECTED' ? "bg-red-100 text-red-800 border-red-200" :
                            "bg-neutral-500 text-white"
                          )}
                        >
                          {(mrs.status === 'ISSUED' || mrs.status === 'FULFILLED') ? 'ISSUED' : mrs.status === 'REJECTED' ? 'Cancelled' : mrs.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Dialog open={openMRSId === mrs.id} onOpenChange={open => setOpenMRSId(open ? mrs.id : null)}>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" onClick={() => { setSelectedMRS(mrs); setOpenMRSId(mrs.id); }}>
                              View Details
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-3xl">
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2">
                                <ClipboardList className="h-5 w-5 text-emerald-600" />
                                MRS Details: {selectedMRS?.mrsNumber}
                              </DialogTitle>
                              <DialogDescription>
                                Requisition details and material line items requested.
                              </DialogDescription>
                            </DialogHeader>

                            {selectedMRS && (
                              <div className="space-y-6">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm bg-neutral-50 p-4 rounded-xl border">
                                  <div>
                                    <span className="text-xs text-neutral-400 block uppercase">Department</span>
                                    <span className="font-semibold">{selectedMRS.department || 'Engineering'}</span>
                                  </div>
                                  {selectedMRS.status === 'REJECTED' && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"><p><strong>Cancelled by:</strong> {selectedMRS.cancelledBy || 'Unknown'}{selectedMRS.cancelledAt ? ` · ${new Date(selectedMRS.cancelledAt).toLocaleString()}` : ''}</p><p className="mt-1"><strong>Reason:</strong> {selectedMRS.cancelReason || 'No reason recorded.'}</p></div>}
                                  <div>
                                    <span className="text-xs text-neutral-400 block uppercase">Requested By</span>
                                    <span className="font-semibold">{selectedMRS.requestedBy}</span>
                                  </div>
                                  <div>
                                    <span className="text-xs text-neutral-400 block uppercase">Purpose Category</span>
                                    <span className="font-semibold">{selectedMRS.purposeCategory}</span>
                                  </div>
                                  <div>
                                    <span className="text-xs text-neutral-400 block uppercase">Prepared By</span>
                                    <span className="font-semibold">{selectedMRS.preparedBy || selectedMRS.requestedBy}</span>
                                  </div>
                                </div>

                                {selectedMRS.otherPurpose && (
                                  <div className="text-sm bg-amber-50 border border-amber-200 p-3 rounded-lg">
                                    <span className="text-xs font-bold text-amber-800 block">Specified Purpose:</span>
                                    <p className="text-amber-900">{selectedMRS.otherPurpose}</p>
                                  </div>
                                )}

                                {/* MRS Items List */}
                                <div className="space-y-3">
                                  <h4 className="font-bold text-sm text-neutral-800">Requested Materials</h4>
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Item Code / Name</TableHead>
                                        <TableHead>Description</TableHead>
                                        <TableHead className="text-right">Qty Requested</TableHead>
                                        <TableHead className="text-right">Qty Approved</TableHead>
                                        <TableHead className="text-right">Qty Issued</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {selectedMRS.items?.map((mrsItem) => {
                                        const item = items.find(i => i.id === mrsItem.itemId);
                                        const itemName = item?.name || mrsItem.customItemName || 'Custom Material';
                                        const itemCode = item?.code || 'NON-STOCK';
                                        const unit = item?.unit || mrsItem.unit || 'pcs';

                                        return (
                                          <TableRow key={mrsItem.id}>
                                            <TableCell className="font-medium">
                                              <div>
                                                <span className="font-bold block text-emerald-700">{itemCode}</span>
                                                <span className="text-neutral-700">{itemName}</span>
                                              </div>
                                            </TableCell>
                                            <TableCell className="text-neutral-500 text-xs">{mrsItem.description || item?.description || '-'}</TableCell>
                                            <TableCell className="text-right font-mono font-bold">{mrsItem.quantityRequested} {unit}</TableCell>
                                            <TableCell className="text-right font-mono">{mrsItem.quantityApproved} {unit}</TableCell>
                                            <TableCell className="text-right font-mono">{mrsItem.quantityIssued} {unit}</TableCell>
                                          </TableRow>
                                        );
                                      })}
                                    </TableBody>
                                  </Table>
                                </div>

                                {(selectedMRS.status === 'PENDING' && can(user?.role, 'mrs:approve', user?.permissions)) ||
                                (selectedMRS.status === 'APPROVED' && can(user?.role, 'mrs:issue', user?.permissions)) ||
                                selectedMRS.status === 'ISSUED' ||
                                canCancelSelectedMRS ? (
                                  <DialogFooter className="flex-col items-stretch gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                      {canCancelSelectedMRS && (
                                        <Button
                                          type="button"
                                          variant="destructive"
                                          onClick={() => {
                                            setCancelReason('');
                                            setCancelOpen(true);
                                          }}
                                        >
                                          Cancel MRS
                                        </Button>
                                      )}
                                    </div>
                                    {selectedMRS.status === 'PENDING' && can(user?.role, 'mrs:approve', user?.permissions) && (
                                      <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => handleApproveMRS(selectedMRS.id)}>
                                        Approve Requisition
                                      </Button>
                                    )}
                                    {selectedMRS.status === 'APPROVED' && can(user?.role, 'mrs:issue', user?.permissions) && (
                                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                                        <div className="space-y-1"><label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Issue from warehouse</label>{restrictedWarehouse ? <p className="h-10 rounded-md border border-input bg-neutral-50 px-3 py-2 text-sm font-medium text-neutral-700">{restrictedWarehouse === 'ENGINEERING' ? 'Engineering Warehouse' : 'Farm Warehouse'}</p> : <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={issueWarehouse} onChange={event => setIssueWarehouse(event.target.value as Warehouse)}><option value="ENGINEERING">Engineering Warehouse</option><option value="FARM">Farm Warehouse</option></select>}</div>
                                        <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => handleIssueMRS(selectedMRS.id)} disabled={isIssuing}>{isIssuing ? 'Issuing...' : 'Issue'}</Button>
                                      </div>
                                    )}
                                    {selectedMRS.status === 'ISSUED' && (
                                      <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => handlePrintStockIssuanceSlip(selectedMRS)}>
                                        Print Stock Issuance Slip
                                      </Button>
                                    )}
                                  </DialogFooter>
                                ) : null}
                                <Dialog open={cancelOpen} onOpenChange={open => {
                                  if (!isCancelling) setCancelOpen(open);
                                }}>
                                  <DialogContent>
                                    <DialogHeader>
                                      <DialogTitle>Cancel MRS {selectedMRS.mrsNumber}?</DialogTitle>
                                      <DialogDescription>Enter a reason for cancellation. Issued requisitions cannot be cancelled.</DialogDescription>
                                    </DialogHeader>
                                    <Textarea value={cancelReason} onChange={event => setCancelReason(event.target.value)} maxLength={2000} placeholder="Cancellation reason (required)" />
                                    <DialogFooter>
                                      <Button type="button" variant="outline" onClick={() => setCancelOpen(false)} disabled={isCancelling}>Keep MRS</Button>
                                      <Button type="button" variant="destructive" disabled={!cancelReason.trim() || isCancelling} onClick={() => void handleCancelMRS()}>{isCancelling ? 'Cancelling…' : 'Confirm Cancellation'}</Button>
                                    </DialogFooter>
                                  </DialogContent>
                                </Dialog>
                              </div>
                            )}
                          </DialogContent>
                        </Dialog>
                      </TableCell>
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
