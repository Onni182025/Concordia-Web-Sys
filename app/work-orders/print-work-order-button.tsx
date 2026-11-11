'use client';

import { Button } from '@/components/ui/button';
import type { Item, WorkOrder } from '@/lib/erp-types';
import { Printer } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

type PrintWorkOrderButtonProps = {
  workOrder: WorkOrder;
  items: Item[];
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return entities[character];
  });
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : escapeHtml(date.toLocaleString());
}

function createPrintDocument(workOrder: WorkOrder, items: Item[]): string {
  const itemRows = (workOrder.items || []).map(orderItem => {
    const item = orderItem.item || items.find(candidate => candidate.id === orderItem.itemId);
    const itemDescription = items.find(candidate => candidate.id === orderItem.itemId)?.description || item?.name || item?.code || 'Unknown item';
    const itemCode = item?.code || '-';
    const unit = item?.unit || '-';

    return `<tr>
      <td>${escapeHtml(itemCode)}</td>
      <td>${escapeHtml(itemDescription)}</td>
      <td class="number">${escapeHtml(String(orderItem.quantityNeeded))}</td>
      <td>${escapeHtml(unit)}</td>
    </tr>`;
  }).join('');
  const title = workOrder.type === 'MRRF'
    ? 'Maintenance and Repair Requisition Form'
    : 'Engineering Project Request';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - ${escapeHtml(workOrder.woNumber)}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body {
      color: #17221c;
      font: 12px/1.45 Arial, Helvetica, sans-serif;
      margin: 0;
    }
    .company { color: #166534; font-size: 17px; font-weight: 700; text-align: center; }
    h1 { border-bottom: 2px solid #166534; font-size: 18px; margin: 5px 0 16px; padding: 0 0 10px; text-align: center; }
    .number { color: #166534; font-size: 14px; font-weight: 700; margin-bottom: 14px; text-align: right; }
    .details { border-collapse: collapse; margin-bottom: 16px; table-layout: fixed; width: 100%; }
    .details td { border: 1px solid #a8b5ac; padding: 7px 8px; vertical-align: top; overflow-wrap: anywhere; }
    .label { background: #f0f7f1; color: #31513b; font-size: 10px; font-weight: 700; text-transform: uppercase; }
    .section-title { color: #166534; font-size: 13px; font-weight: 700; margin: 18px 0 7px; }
    .materials { border-collapse: collapse; width: 100%; }
    .materials th, .materials td { border: 1px solid #89978d; padding: 7px 8px; text-align: left; vertical-align: top; }
    .materials th { background: #e9f3eb; color: #244b30; font-size: 10px; text-transform: uppercase; }
    .materials .number { color: inherit; font-size: inherit; margin: 0; text-align: right; }
    .signatures { display: grid; gap: 38px; grid-template-columns: 1fr 1fr; margin-top: 62px; page-break-inside: avoid; }
    .signature { border-top: 1px solid #37443b; padding-top: 7px; text-align: center; }
    .signature strong { display: block; }
    .signature span { color: #536157; font-size: 10px; }
  </style>
</head>
<body>
  <div class="company">Concordia Agribusiness Corporation</div>
  <h1>${escapeHtml(title)}</h1>
  <div class="number">Job Order No.: ${escapeHtml(workOrder.woNumber)}</div>
  <table class="details">
    <tbody>
      <tr>
        <td class="label">Date &amp; Time Requested</td>
        <td>${formatDate(workOrder.dateRequested)}</td>
        <td class="label">Date &amp; Time Needed</td>
        <td>${formatDate(workOrder.dateNeeded)}</td>
      </tr>
      <tr>
        <td class="label">Requesting Department</td>
        <td>${escapeHtml(workOrder.department || '-')}</td>
        <td class="label">Priority</td>
        <td>${escapeHtml(workOrder.priority)}</td>
      </tr>
      <tr>
        <td class="label">Requested By / Prepared By</td>
        <td>${escapeHtml(workOrder.requestedBy || '-')}</td>
        <td class="label">Machine / Equipment Name</td>
        <td>${escapeHtml(workOrder.machineEquipment || '-')}</td>
      </tr>
      <tr>
        <td class="label">Area / Building</td>
        <td>${escapeHtml(workOrder.areaBuilding || '-')}</td>
        <td class="label">Specification</td>
        <td>${escapeHtml(workOrder.specification || '-')}</td>
      </tr>
      <tr>
        <td class="label" colspan="1">Description of Trouble / Breakdown</td>
        <td colspan="3">${escapeHtml(workOrder.description || '-').replace(/\n/g, '<br>')}</td>
      </tr>
    </tbody>
  </table>
  <div class="section-title">Items / Materials Needed</div>
  <table class="materials">
    <thead><tr><th>Item Code</th><th>Description</th><th class="number">Quantity</th><th>Unit</th></tr></thead>
    <tbody>${itemRows || '<tr><td colspan="4">No materials were requested.</td></tr>'}</tbody>
  </table>
  <div class="signatures">
    <div class="signature"><strong>Prepared by</strong><span>Requesting Personnel</span></div>
    <div class="signature"><strong>Approved by</strong><span>Department Immediate Head</span></div>
  </div>
</body>
</html>`;
}

export function PrintWorkOrderButton({ workOrder, items }: PrintWorkOrderButtonProps) {
  const handlePrint = () => {
    const frame = document.createElement('iframe');
    frame.title = 'Printable Job Order';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);

    const printDocument = frame.contentDocument;
    const printWindow = frame.contentWindow;
    if (!printDocument || !printWindow) {
      frame.remove();
      toast({ title: 'Unable to print Job Order', description: 'Your browser could not prepare the print view.', variant: 'destructive' });
      return;
    }

    printDocument.open();
    printDocument.write(createPrintDocument(workOrder, items));
    printDocument.close();

    let cleanupTimeout: number;
    const cleanup = () => {
      window.clearTimeout(cleanupTimeout);
      frame.remove();
    };
    printWindow.addEventListener('afterprint', cleanup, { once: true });
    cleanupTimeout = window.setTimeout(cleanup, 60_000);

    try {
      printWindow.focus();
      printWindow.print();
    } catch {
      cleanup();
      toast({ title: 'Unable to print Job Order', description: 'Please try again or use your browser’s print controls.', variant: 'destructive' });
    }
  };

  return (
    <Button type="button" variant="outline" onClick={handlePrint}>
      <Printer className="mr-2 h-4 w-4" />
      Print MRRF/EPRF
    </Button>
  );
}
