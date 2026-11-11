'use client';

import { useState, useEffect } from 'react';
import { getDashboardData } from '@/app/actions/erp-actions';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  FileText, 
  ClipboardList, 
  AlertTriangle, 
  TrendingUp, 
  Package, 
  ArrowRight,
  CheckCircle2,
  Clock,
  Sprout
} from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';

export default function Dashboard() {
  const { user } = useAuth();
  const [dashboardData, setDashboardData] = useState<Awaited<ReturnType<typeof getDashboardData>> | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    getDashboardData(user.id)
      .then(setDashboardData)
      .catch(error => toast({
        title: 'Unable to load dashboard',
        description: error instanceof Error ? error.message : 'Database operation failed.',
        variant: 'destructive',
      }));
  }, [user?.id, user?.role]);

  const pendingWorkOrders = dashboardData?.pendingWorkOrders || 0;
  const pendingMRS = dashboardData?.pendingMRS || 0;
  const lowStockItems = dashboardData?.lowStockItems || [];
  const recentWorkOrders = dashboardData?.recentWorkOrders || [];

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-800 to-emerald-950 p-8 text-white shadow-lg">
        <div className="absolute right-0 top-0 -translate-y-12 translate-x-12 opacity-10">
          <Sprout className="h-96 w-96" />
        </div>
        <div className="relative z-10 max-w-2xl">
          <span className="inline-block bg-emerald-700/50 text-emerald-300 text-xs font-semibold px-3 py-1 rounded-full border border-emerald-600/30 mb-4">
            Concordia Agribusiness Corporation
          </span>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Concordia Centralized System</h1>
          <p className="text-emerald-100/80 text-sm leading-relaxed">
            Streamlined Job Orders, Material Requisitions, and fully separated Engineering & Farm Warehouse inventory tracking.
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="border-l-4 border-l-amber-500 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-neutral-500">Pending Job Orders</CardTitle>
            <FileText className="h-5 w-5 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{pendingWorkOrders}</div>
            <p className="text-xs text-neutral-400 mt-1">Awaiting review & approval</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-neutral-500">Pending MRS</CardTitle>
            <ClipboardList className="h-5 w-5 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{pendingMRS}</div>
            <p className="text-xs text-neutral-400 mt-1">Material Requisition Slips</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-red-500 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-neutral-500">Low Stock Alerts</CardTitle>
            <AlertTriangle className="h-5 w-5 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{dashboardData?.lowStockCount || 0}</div>
            <p className="text-xs text-neutral-400 mt-1">Across both warehouses</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-600 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-neutral-500">Total Catalog Items</CardTitle>
            <Package className="h-5 w-5 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboardData?.itemCount || 0}</div>
            <p className="text-xs text-neutral-400 mt-1">Tracked materials & spares</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Job Orders */}
        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg font-bold">Recent Job Orders</CardTitle>
              <CardDescription>Latest maintenance and project requests</CardDescription>
            </div>
            <Link href="/work-orders" className="text-xs text-emerald-600 hover:underline flex items-center gap-1">
              View All <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {recentWorkOrders.length === 0 ? (
              <div className="text-center py-8 text-neutral-400 text-sm">
                No job orders created yet. Click &quot;Job Orders&quot; to create one.
              </div>
            ) : (
              <div className="divide-y divide-neutral-100">
                {recentWorkOrders.map((wo) => (
                  <div key={wo.id} className="py-4 flex items-center justify-between first:pt-0 last:pb-0">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-neutral-900">{wo.woNumber}</span>
                        <Badge variant="outline" className="text-[10px] font-semibold">
                          {wo.type}
                        </Badge>
                        <Badge 
                          className={cn(
                            "text-[10px] font-semibold",
                            wo.priority === 'CRITICAL' ? "bg-red-100 text-red-700 border-red-200" :
                            wo.priority === 'HIGH' ? "bg-amber-100 text-amber-700 border-amber-200" :
                            "bg-neutral-100 text-neutral-700"
                          )}
                        >
                          {wo.priority}
                        </Badge>
                      </div>
                      <p className="text-xs text-neutral-500 truncate max-w-md">{wo.description}</p>
                      <div className="flex items-center gap-4 text-[11px] text-neutral-400">
                        <span>Dept: {wo.department}</span>
                        <span>Needed: {new Date(wo.dateNeeded).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div>
                      <Badge 
                        className={cn(
                          "font-semibold",
                          wo.status === 'PENDING' ? "bg-amber-500 text-white" :
                          wo.status === 'APPROVED' ? "bg-blue-500 text-white" :
                          wo.status === 'COMPLETED' ? "bg-emerald-600 text-white" :
                          "bg-neutral-500 text-white"
                        )}
                      >
                        {wo.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Low Stock Alerts Panel */}
        <Card className="shadow-sm border-red-100">
          <CardHeader className="bg-red-50/50 border-b border-red-100">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <CardTitle className="text-base font-bold text-red-900">Critical Stock Alerts</CardTitle>
            </div>
            <CardDescription className="text-red-700/70">Items below minimum stock level</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {lowStockItems.length === 0 ? (
              <div className="text-center py-8 text-neutral-400 text-sm">
                All items are well stocked!
              </div>
            ) : (
              <div className="divide-y divide-neutral-100 max-h-[380px] overflow-y-auto">
                {lowStockItems.map((stock) => (
                  <div key={stock.id} className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-neutral-900">{stock.itemName}</p>
                      <p className="text-xs text-neutral-400">{stock.itemCode}</p>
                      <Badge 
                        variant="outline" 
                        className={cn(
                          "text-[10px] mt-1",
                          stock.warehouse === 'ENGINEERING' ? "border-emerald-200 text-emerald-700 bg-emerald-50" : "border-blue-200 text-blue-700 bg-blue-50"
                        )}
                      >
                        {stock.warehouse} WH
                      </Badge>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-bold text-red-600">{stock.quantity}</span>
                      <span className="text-xs text-neutral-400"> / {stock.minStockLevel} {stock.unit}</span>
                      <p className="text-[10px] text-neutral-400 mt-0.5">Min Level</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
