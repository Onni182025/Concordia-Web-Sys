import { z } from 'zod';

const nonPlaceholderText = (label: string) => z.string().trim().min(1, `${label} is required`).refine(value => {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return !/^(?:test(?:ing)?|dummy|placeholder|sample|tbd|n a|na|none|unknown|asdf|xxx|lorem ipsum|select(?: an)? item|[-]+)$/.test(normalized)
    && !/\b(?:dummy|placeholder|lorem ipsum)\b/.test(normalized);
}, `${label} cannot contain placeholder or dummy text`);

export const workOrderFormSchema = z.object({
  dateNeeded: z.string().min(1, 'Date Needed is required'),
  department: nonPlaceholderText('Department'),
  machineEquipment: nonPlaceholderText('Equipment'),
  requestedBy: nonPlaceholderText('Requester'),
  items: z.array(z.object({
    itemId: nonPlaceholderText('Item selection'),
    quantityNeeded: z.number().finite().positive('Quantity must be greater than 0'),
  })).superRefine((items, ctx) => {
    const itemIds = new Set<string>();
    items.forEach((item, index) => {
      if (itemIds.has(item.itemId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Each item may only be selected once', path: [index, 'itemId'] });
      }
      itemIds.add(item.itemId);
    });
  }),
});

export type WorkOrderFormValues = z.infer<typeof workOrderFormSchema>;
