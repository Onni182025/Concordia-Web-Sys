'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import type { WorkOrder, Item, Permission, Role, WarehouseStock } from '@/lib/erp-types';
import { cancelWorkOrder, createWorkOrder, getDocumentNumberPreview, getWorkOrderFormData, getWorkOrderListPage, updateWorkOrderStatus } from '@/app/actions/erp-actions';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Plus, Search, FileText, AlertCircle, CheckCircle2, ClipboardList, ArrowRight, HelpCircle, CircleCheck, PackageCheck, ExternalLink } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { can } from '@/lib/rbac';
import { workOrderFormSchema } from '@/lib/schemas/work-order-schema';
import { PrintWorkOrderButton } from './print-work-order-button';
import { TablePagination } from '@/components/shared/table-pagination';

export default function WorkOrdersPage() {
  const { user } = useAuth();
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [stocks, setStocks] = useState<WarehouseStock[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [listPage, setListPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedWO, setSelectedWO] = useState<WorkOrder | null>(null);
  const [workOrderNumberPreview, setWorkOrderNumberPreview] = useState('');

  // Form States
  const [type, setType] = useState<'MRRF' | 'EPRF'>('MRRF');
  const [dateNeeded, setDateNeeded] = useState('');
  const [department, setDepartment] = useState('');
  const [machineEquipment, setMachineEquipment] = useState('');
  const [areaBuilding, setAreaBuilding] = useState('');
  const [specification, setSpecification] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('MEDIUM');
  const [requestedBy, setRequestedBy] = useState('');
  const [selectedWarehouse, setSelectedWarehouse] = useState<'ENGINEERING' | 'FARM'>('ENGINEERING');

  // Selected items for the Job Order
  const [woItems, setWoItems] = useState<{ itemId: string; quantityNeeded: number }[]>([]);
  const [currentItemId, setCurrentItemId] = useState('');
  const [currentQty, setCurrentQty] = useState('1');

  useEffect(() => {
    if (!user?.id) return;
    getWorkOrderFormData(user.id).then(data => { setItems(data.items); setStocks(data.stocks); }).catch(error => toast({ title: 'Unable to load Job Order form data', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    getWorkOrderListPage({ page: listPage, search: searchQuery }, user.id)
      .then(result => { setWorkOrders(result.rows); setListTotal(result.total); })
      .catch(error => toast({ title: 'Unable to load Job Orders', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }));
  }, [listPage, searchQuery, user?.id]);

  useEffect(() => {
    if (!user?.id || !can(user.role, 'work-orders:create', user.permissions)) return;
    getDocumentNumberPreview('WORK_ORDER', user.id)
      .then(setWorkOrderNumberPreview)
      .catch(error => toast({ title: 'Unable to load Job Order number', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }));
  }, [user?.id, user?.role, user?.permissions]);

  const handleAddMaterial = () => {
    if (!currentItemId) return;
    const qty = parseFloat(currentQty);
    if (isNaN(qty) || qty <= 0) {
      toast({ title: 'Invalid Quantity', description: 'Please enter a valid quantity.', variant: 'destructive' });
      return;
    }

    // Check if item already added
    if (woItems.some(i => i.itemId === currentItemId)) {
      toast({ title: 'Duplicate Item', description: 'This item is already added to the list.', variant: 'destructive' });
      return;
    }

    setWoItems([...woItems, { itemId: currentItemId, quantityNeeded: qty }]);
    setCurrentItemId('');
    setCurrentQty('1');
  };

  const handleRemoveMaterial = (index: number) => {
    setWoItems(woItems.filter((_, i) => i !== index));
  };

  const handleCreateWorkOrder = async (e: React.FormEvent) => {
    e.preventDefault();

    const validation = workOrderFormSchema.safeParse({
      dateNeeded,
      department,
      machineEquipment,
      requestedBy,
      items: woItems,
    });
    if (!validation.success) {
      toast({ title: 'Please review the Job Order', description: validation.error.issues[0]?.message || 'Correct the highlighted Job Order details.', variant: 'destructive' });
      return;
    }

    try {
      if (!user?.id) throw new Error('You must be signed in.');
      const newWO = await createWorkOrder({ type, dateNeeded, department, machineEquipment, areaBuilding, specification, description, priority, requestedBy, createdById: user.id, items: woItems });

    toast({
      title: 'Job Order Created',
      description: `Successfully created ${newWO.woNumber}.`,
    });

    // Reset Form
    setIsCreateOpen(false);
    setWoItems([]);
    setDepartment('');
    setMachineEquipment('');
    setAreaBuilding('');
    setSpecification('');
    setDescription('');
    setRequestedBy('');
    setListPage(1);
    const refreshedPage = await getWorkOrderListPage({ page: 1, search: searchQuery }, user.id);
    setWorkOrders(refreshedPage.rows);
    setListTotal(refreshedPage.total);
    void getDocumentNumberPreview('WORK_ORDER', user.id)
      .then(setWorkOrderNumberPreview)
      .catch(error => toast({ title: 'Unable to refresh Job Order number', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }));
    } catch (error) { toast({ title: 'Unable to create Job Order', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }); }
  };

  const handleApproveWO = async (woId: string) => {
    try {
    if (!user) throw new Error('You must be signed in.');
    const updated = await updateWorkOrderStatus(woId, 'APPROVED', user.id);
    setWorkOrders(current => current.map(wo => wo.id === woId ? updated : wo));
    if (selectedWO?.id === woId) {
      setSelectedWO({ ...selectedWO, status: 'APPROVED' });
    }
    toast({ title: 'Job Order Approved', description: 'The Job Order status has been updated to Approved.' });
    } catch (error) { toast({ title: 'Unable to approve Job Order', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }); }
  };

  const handleStatusChange = async (woId: string, status: WorkOrder['status']) => {
    try {
      if (!user) throw new Error('You must be signed in.');
      const updated = await updateWorkOrderStatus(woId, status, user.id);
      setWorkOrders(current => current.map(wo => wo.id === woId ? { ...wo, status: updated.status } : wo));
      setSelectedWO(current => current?.id === woId ? { ...current, status: updated.status } : current);
      toast({ title: 'Job Order Updated', description: `Status changed to ${status.replace(/_/g, ' ')}.` });
    } catch (error) { toast({ title: 'Unable to update Job Order', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }); }
  };

  const handleCancelWorkOrder = async (woId: string, reason: string) => {
    try {
      if (!user?.id) throw new Error('You must be signed in.');
      const updated = await cancelWorkOrder(woId, reason, user.id);
      setWorkOrders(current => current.map(order => order.id === woId ? updated : order));
      setSelectedWO(updated);
      toast({ title: 'Job Order Cancelled', description: `${updated.woNumber} was cancelled.` });
    } catch (error) {
      toast({ title: 'Unable to cancel Job Order', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' });
      throw error;
    }
  };

  const filteredWOs = workOrders;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Job Orders & Maintenance Requests</h1>
          <p className="text-sm text-neutral-500">Manage MRRF and EPRF requests from the Engineering Department</p>
        </div>

        {user && can(user.role, 'work-orders:create', user.permissions) && <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2">
              <Plus className="h-4 w-4" /> New Job Order
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Job Order / Maintenance Request</DialogTitle>
              <DialogDescription>
                Fill in the official form details. Review stock availability, then create a linked MRS from Job Order details when materials are needed.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateWorkOrder} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-neutral-500 uppercase">Job Order Number (System Generated)</label>
                  <Input value={workOrderNumberPreview || 'Loading series...'} readOnly className="border-emerald-200 bg-emerald-50 font-mono font-semibold text-emerald-800" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-neutral-500 uppercase">Request Type</label>
                  <Select value={type} onValueChange={(val: 'MRRF' | 'EPRF') => setType(val)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MRRF">MRRF (Maintenance Repair Request)</SelectItem>
                      <SelectItem value="EPRF">EPRF (Engineering Project Request)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-neutral-500 uppercase">Target Warehouse (For Stock Check)</label>
                  <Select value={selectedWarehouse} onValueChange={(val: 'ENGINEERING' | 'FARM') => setSelectedWarehouse(val)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select Warehouse" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ENGINEERING">Engineering Warehouse</SelectItem>
                      <SelectItem value="FARM">Farm Warehouse</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-neutral-500 uppercase">Date Needed</label>
                  <Input type="date" value={dateNeeded} onChange={e => setDateNeeded(e.target.value)} required />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-neutral-500 uppercase">Department</label>
                  <Input placeholder="e.g., Feedmill, Irrigation, Processing" value={department} onChange={e => setDepartment(e.target.value)} required />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-neutral-500 uppercase">Machine / Equipment</label>
                  <Input placeholder="e.g., Conveyor Motor B, Generator Set 2" value={machineEquipment} onChange={e => setMachineEquipment(e.target.value)} required />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-neutral-500 uppercase">Area / Building</label>
                  <Input placeholder="e.g., Warehouse 3, Pump Station A" value={areaBuilding} onChange={e => setAreaBuilding(e.target.value)} required />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-neutral-500 uppercase">Priority</label>
                  <Select value={priority} onValueChange={(val: any) => setPriority(val)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select Priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LOW">Low</SelectItem>
                      <SelectItem value="MEDIUM">Medium</SelectItem>
                      <SelectItem value="HIGH">High</SelectItem>
                      <SelectItem value="CRITICAL">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-neutral-500 uppercase">Requested By (Free Text)</label>
                  <Input placeholder="e.g., Engr. Juan Dela Cruz" value={requestedBy} onChange={e => setRequestedBy(e.target.value)} required />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-neutral-500 uppercase">Specification / Technical Details</label>
                <Textarea placeholder="Enter technical specifications, model numbers, dimensions, etc." value={specification} onChange={e => setSpecification(e.target.value)} />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-neutral-500 uppercase">Description of Problem / Project Scope</label>
                <Textarea placeholder="Describe the issue or project requirements in detail" value={description} onChange={e => setDescription(e.target.value)} required />
              </div>

              {/* Materials Needed Section */}
              <div className="border-t pt-4 space-y-4">
                <h3 className="font-bold text-sm text-neutral-800">Materials / Items Needed</h3>
                
                <div className="flex gap-3 items-end">
                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] font-semibold text-neutral-500 uppercase">Select Material</label>
                    <Select value={currentItemId} onValueChange={setCurrentItemId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose item..." />
                      </SelectTrigger>
                      <SelectContent>
                        {items.map(item => {
                          const stock = stocks.find(s => s.itemId === item.id && s.warehouse === selectedWarehouse);
                          return (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name} ({item.code}) - Stock: {stock ? stock.quantity : 0} {item.unit}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="w-24 space-y-1">
                    <label className="text-[10px] font-semibold text-neutral-500 uppercase">Qty</label>
                    <Input type="number" min="1" value={currentQty} onChange={e => setCurrentQty(e.target.value)} />
                  </div>

                  <Button type="button" onClick={handleAddMaterial} className="bg-neutral-800 hover:bg-neutral-700 text-white">
                    Add
                  </Button>
                </div>

                {/* Added Materials Table */}
                {woItems.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item Code</TableHead>
                        <TableHead>Item Name</TableHead>
                        <TableHead className="text-right">Qty Needed</TableHead>
                        <TableHead className="text-right">Available Stock</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {woItems.map((woItem, idx) => {
                        const item = items.find(i => i.id === woItem.itemId);
                        const stock = stocks.find(s => s.itemId === woItem.itemId && s.warehouse === selectedWarehouse);
                        const available = stock ? stock.quantity : 0;
                        const isSufficient = available >= woItem.quantityNeeded;

                        return (
                          <TableRow key={idx}>
                            <TableCell className="font-medium">{item?.code}</TableCell>
                            <TableCell>{item?.name}</TableCell>
                            <TableCell className="text-right">{woItem.quantityNeeded} {item?.unit}</TableCell>
                            <TableCell className="text-right">{available} {item?.unit}</TableCell>
                            <TableCell className="text-right">
                              {isSufficient ? (
                                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">In Stock</Badge>
                              ) : (
                                <Badge className="bg-amber-100 text-amber-800 border-amber-200">
                                Deficit: {woItem.quantityNeeded - available} (MRS Required)
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button type="button" variant="ghost" size="sm" className="text-red-500 hover:text-red-700" onClick={() => handleRemoveMaterial(idx)}>
                                Remove
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white">Submit Job Order</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>}
      </div>

      {/* Search & Filter */}
      <div className="flex items-center gap-3 bg-white p-4 rounded-xl border shadow-sm">
        <Search className="h-5 w-5 text-neutral-400" />
        <Input 
          placeholder="Search by Job Order Number, Requester, or Department..." 
          value={searchQuery}
          className="border-none shadow-none focus-visible:ring-0"
          onChange={e => { setSearchQuery(e.target.value); setListPage(1); }}
        />
      </div>

      {/* Job Orders Table */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job Order Number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Machine/Equipment</TableHead>
                <TableHead>Requested By</TableHead>
                <TableHead>Date Needed</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredWOs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-neutral-400">
                    No Job Orders found matching your search.
                  </TableCell>
                </TableRow>
              ) : (
                filteredWOs.map((wo) => (
                  <TableRow key={wo.id}>
                    <TableCell className="font-bold text-emerald-700">{wo.woNumber}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{wo.type}</Badge>
                    </TableCell>
                    <TableCell>{wo.department}</TableCell>
                    <TableCell>{wo.machineEquipment}</TableCell>
                    <TableCell>{wo.requestedBy}</TableCell>
                    <TableCell>{new Date(wo.dateNeeded).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Badge 
                        className={cn(
                          "font-semibold",
                          wo.priority === 'CRITICAL' ? "bg-red-100 text-red-700 border-red-200" :
                          wo.priority === 'HIGH' ? "bg-amber-100 text-amber-700 border-amber-200" :
                          "bg-neutral-100 text-neutral-700"
                        )}
                      >
                        {wo.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          "font-semibold",
                          wo.status === 'PENDING' ? "bg-amber-500 text-white" :
                          wo.status === 'APPROVED' ? "bg-blue-500 text-white" :
                          wo.status === 'COMPLETED' ? "bg-emerald-600 text-white" :
                          wo.status === 'REJECTED' ? "border-red-200 bg-red-100 text-red-800" :
                          "bg-neutral-500 text-white"
                        )}
                      >
                        {wo.status === 'REJECTED' ? 'Cancelled' : wo.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" onClick={() => setSelectedWO(wo)}>
                            View Details
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">
                          <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                              <FileText className="h-5 w-5 text-emerald-600" />
                              Job Order Details: {selectedWO?.woNumber}
                            </DialogTitle>
                            <DialogDescription>
                              Full traceability and process flow for this maintenance request.
                            </DialogDescription>
                          </DialogHeader>

                          {selectedWO && <WorkOrderDetails workOrder={selectedWO} items={items} stocks={stocks} userRole={user?.role} userPermissions={user?.permissions} onApprove={handleApproveWO} onStatusChange={handleStatusChange} onCancel={handleCancelWorkOrder} />}
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
        <TablePagination page={listPage} pageSize={20} total={listTotal} onPageChange={setListPage} />
      </Card>
    </div>
  );
}

function WorkOrderDetails({ workOrder, items, stocks, userRole, userPermissions, onApprove, onStatusChange, onCancel }: { workOrder: WorkOrder; items: Item[]; stocks: WarehouseStock[]; userRole?: Role; userPermissions?: Permission[]; onApprove: (id: string) => Promise<void>; onStatusChange: (id: string, status: WorkOrder['status']) => Promise<void>; onCancel: (id: string, reason: string) => Promise<void> }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const mrsList = workOrder.mrsList || [];
  const activeMRSList = mrsList.filter(mrs => mrs.status !== 'REJECTED');
  const allItemsCoveredByMRS = (workOrder.items || []).length === 0 || (workOrder.items || []).every(orderItem => {
    const requested = activeMRSList.flatMap(mrs => mrs.items)
      .filter(item => item.itemId === orderItem.itemId)
      .reduce((total, item) => total + item.quantityRequested, 0);
    return requested >= orderItem.quantityNeeded;
  });
  const allMaterialsIssued = (workOrder.items || []).every(orderItem => orderItem.quantityIssued >= orderItem.quantityNeeded);
  const canApproveWorkOrder = can(userRole, 'work-orders:approve', userPermissions)
    && (workOrder.type !== 'MRRF' || can(userRole, 'work-orders:mrrf:approve', userPermissions));
  const stages = [
    { label: 'Requested', done: true },
    { label: 'Approved', done: workOrder.status !== 'PENDING' },
    { label: 'MRS Created', done: mrsList.length > 0 },
    { label: 'Materials Issued', done: allMaterialsIssued },
    { label: workOrder.status === 'COMPLETED' ? 'Completed' : 'In Progress', done: workOrder.status === 'COMPLETED' || workOrder.status === 'IN_PROGRESS' },
  ];
  const statusClass = workOrder.status === 'PENDING' ? 'bg-amber-100 text-amber-800' : workOrder.status === 'APPROVED' ? 'bg-blue-100 text-blue-800' : workOrder.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : workOrder.status === 'REJECTED' ? 'bg-red-100 text-red-800' : 'bg-neutral-100 text-neutral-700';
  const priorityClass = workOrder.priority === 'CRITICAL' ? 'bg-red-100 text-red-800' : workOrder.priority === 'HIGH' ? 'bg-amber-100 text-amber-800' : 'bg-neutral-100 text-neutral-700';

  return <div className="max-h-[72vh] space-y-5 overflow-y-auto pr-1">
    <div className="flex justify-end">
      <PrintWorkOrderButton workOrder={workOrder} items={items} />
    </div>
    <div className="flex flex-col gap-3 rounded-xl border bg-emerald-50/60 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">Job Order</p><h2 className="text-xl font-bold text-neutral-900">{workOrder.woNumber}</h2></div><div className="flex flex-wrap gap-2"><Badge variant="outline" className="border-emerald-200 bg-white text-emerald-800">{workOrder.type}</Badge><Badge className={priorityClass}>{workOrder.priority}</Badge><Badge className={statusClass}>{workOrder.status === 'REJECTED' ? 'Cancelled' : workOrder.status.replace(/_/g, ' ')}</Badge></div></div>
    {workOrder.status === 'REJECTED' && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"><p><strong>Cancelled by:</strong> {workOrder.cancelledBy || 'Unknown'}{workOrder.cancelledAt ? ` · ${new Date(workOrder.cancelledAt).toLocaleString()}` : ''}</p><p className="mt-1"><strong>Reason:</strong> {workOrder.cancelReason || 'No reason recorded.'}</p></div>}
    <section className="rounded-xl border p-4"><SectionTitle icon={<ArrowRight className="h-4 w-4" />} title="Process Flow & Traceability" /><div className="grid gap-3 sm:grid-cols-5">{stages.map((stage, index) => <div key={stage.label} className="relative flex items-center gap-3 sm:block sm:text-center"><div className={cn('mx-0 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold sm:mx-auto', stage.done ? 'bg-emerald-600 text-white' : 'bg-neutral-100 text-neutral-400')}>{stage.done ? <CircleCheck className="h-4 w-4" /> : index + 1}</div><p className="text-xs font-semibold text-neutral-700 sm:mt-2">{stage.label}</p>{index < stages.length - 1 && <div className="hidden h-px bg-neutral-200 sm:absolute sm:left-[60%] sm:top-[18px] sm:block sm:w-[80%]" />}</div>)}</div></section>
    <section className="rounded-xl border p-4"><SectionTitle icon={<FileText className="h-4 w-4" />} title="Request Information" /><div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3"><Detail label="Date & Time Requested" value={new Date(workOrder.dateRequested).toLocaleString()} /><Detail label="Date Needed" value={new Date(workOrder.dateNeeded).toLocaleDateString()} /><Detail label="Requested By" value={workOrder.requestedBy} /><Detail label="Department" value={workOrder.department} /><Detail label="Machine / Equipment" value={workOrder.machineEquipment} /><Detail label="Area / Building" value={workOrder.areaBuilding} /><Detail label="Specification" value={workOrder.specification || 'No specification provided'} wide /><Detail label="Description of Trouble / Breakdown" value={workOrder.description} wide /></div></section>
    <section className="rounded-xl border p-4"><SectionTitle icon={<PackageCheck className="h-4 w-4" />} title="Items / Materials Needed" />{workOrder.items?.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Item Code / Name</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Stock Availability</TableHead><TableHead>Issuance Status</TableHead></TableRow></TableHeader><TableBody>{workOrder.items.map(orderItem => { const item = orderItem.item || items.find(value => value.id === orderItem.itemId); const available = stocks.filter(stock => stock.itemId === orderItem.itemId).reduce((total, stock) => total + stock.quantity, 0); const itemMRS = activeMRSList.flatMap(mrs => mrs.items).filter(mrsItem => mrsItem.itemId === orderItem.itemId); const issued = itemMRS.reduce((total, mrsItem) => total + mrsItem.quantityIssued, 0); const requested = itemMRS.reduce((total, mrsItem) => total + mrsItem.quantityRequested, 0); const issuanceStatus = itemMRS.length === 0 ? 'Not Requisitioned' : issued >= orderItem.quantityNeeded ? 'Issued' : issued > 0 ? 'Partially Issued' : 'Pending'; const issuanceClass = issuanceStatus === 'Issued' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : issuanceStatus === 'Partially Issued' ? 'bg-amber-100 text-amber-800 border-amber-200' : issuanceStatus === 'Pending' ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-neutral-100 text-neutral-700 border-neutral-200'; return <TableRow key={orderItem.id}><TableCell><p className="font-semibold">{item?.code || 'Unknown item'}</p><p className="text-xs text-neutral-500">{item?.name || orderItem.itemId}</p></TableCell><TableCell className="text-right font-semibold">{orderItem.quantityNeeded}</TableCell><TableCell>{item?.unit || '-'}</TableCell><TableCell className={cn('text-right font-semibold', available >= orderItem.quantityNeeded ? 'text-emerald-700' : 'text-red-600')}>{available} {item?.unit || ''}</TableCell><TableCell><Badge className={issuanceClass}>{issuanceStatus}{issuanceStatus === 'Partially Issued' ? ` · ${issued} / ${orderItem.quantityNeeded}` : requested > 0 && issuanceStatus === 'Pending' ? ` · ${requested} requested` : ''}</Badge></TableCell></TableRow>; })}</TableBody></Table></div> : <EmptyState text="No materials were added to this Job Order." />}</section>
    <section className="rounded-xl border p-4"><SectionTitle icon={<ClipboardList className="h-4 w-4" />} title="Linked Material Requisition Slips (MRS)" />{mrsList.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>MRS Number</TableHead><TableHead>Creation Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Manage</TableHead></TableRow></TableHeader><TableBody>{mrsList.map(mrs => <TableRow key={mrs.id}><TableCell className="font-semibold text-emerald-700">{mrs.mrsNumber}</TableCell><TableCell>{new Date(mrs.createdAt).toLocaleDateString()}</TableCell><TableCell><Badge variant="outline">{mrs.status}</Badge></TableCell><TableCell className="text-right"><Button variant="outline" size="sm" asChild><Link href={`/mrs?mrsNumber=${encodeURIComponent(mrs.mrsNumber)}`}>View / Manage <ExternalLink className="ml-2 h-3 w-3" /></Link></Button></TableCell></TableRow>)}</TableBody></Table></div> : <EmptyState text="No Material Requisition created yet" />}</section>
    {can(userRole, 'work-orders:view', userPermissions) && <DialogFooter className="border-t pt-4"><div className="flex w-full flex-wrap justify-end gap-2">{workOrder.status === 'PENDING' && canApproveWorkOrder && <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => void onApprove(workOrder.id)}><CheckCircle2 className="mr-2 h-4 w-4" />Approve</Button>}{workOrder.status === 'APPROVED' && can(userRole, 'work-orders:approve', userPermissions) && <Button variant="outline" disabled={!allMaterialsIssued} onClick={() => void onStatusChange(workOrder.id, 'IN_PROGRESS')}>Start Work</Button>}{workOrder.status === 'IN_PROGRESS' && can(userRole, 'work-orders:approve', userPermissions) && <Button className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={!allMaterialsIssued} onClick={() => void onStatusChange(workOrder.id, 'COMPLETED')}><CheckCircle2 className="mr-2 h-4 w-4" />Mark as Completed</Button>}{can(userRole, 'mrs:create', userPermissions) && <Button className="bg-emerald-600 text-white hover:bg-emerald-700" asChild disabled={allItemsCoveredByMRS || workOrder.status === 'COMPLETED' || workOrder.status === 'REJECTED'}><Link aria-disabled={allItemsCoveredByMRS || workOrder.status === 'COMPLETED' || workOrder.status === 'REJECTED'} tabIndex={allItemsCoveredByMRS || workOrder.status === 'COMPLETED' || workOrder.status === 'REJECTED' ? -1 : undefined} className={allItemsCoveredByMRS || workOrder.status === 'COMPLETED' || workOrder.status === 'REJECTED' ? 'pointer-events-none' : undefined} href={`/mrs/new?workOrderId=${encodeURIComponent(workOrder.id)}`}>Create MRS</Link></Button>}{(userRole === 'ENGINEERING_SUPERVISOR' || userRole === 'SUPER_ADMIN') && workOrder.status !== 'APPROVED' && workOrder.status !== 'REJECTED' && <Dialog open={cancelOpen} onOpenChange={setCancelOpen}><Button type="button" variant="destructive" onClick={() => setCancelOpen(true)}>Cancel Job Order</Button><DialogContent><DialogHeader><DialogTitle>Cancel Job Order {workOrder.woNumber}?</DialogTitle><DialogDescription>This action cannot be undone. Enter a reason to cancel this Job Order.</DialogDescription></DialogHeader><Textarea value={cancelReason} onChange={event => setCancelReason(event.target.value)} maxLength={2000} placeholder="Cancellation reason (required)" /><DialogFooter><Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>Keep Job Order</Button><Button type="button" variant="destructive" disabled={!cancelReason.trim() || cancelling} onClick={() => { setCancelling(true); void onCancel(workOrder.id, cancelReason).then(() => { setCancelReason(''); setCancelOpen(false); }).catch(() => undefined).finally(() => setCancelling(false)); }}>{cancelling ? 'Cancelling…' : 'Confirm Cancellation'}</Button></DialogFooter></DialogContent></Dialog>}</div></DialogFooter>}
  </div>;
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) { return <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-neutral-700">{icon}<span>{title}</span></h3>; }
function Detail({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) { return <div className={cn('rounded-lg bg-neutral-50 p-3', wide && 'sm:col-span-2 lg:col-span-3')}><p className="text-xs text-neutral-500">{label}</p><p className="mt-1 whitespace-pre-wrap font-medium text-neutral-900">{value}</p></div>; }
function EmptyState({ text }: { text: string }) { return <div className="rounded-lg border border-dashed bg-neutral-50 p-6 text-center text-sm text-neutral-500">{text}</div>; }
