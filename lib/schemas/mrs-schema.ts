import { z } from 'zod';

export const mrsItemSchema = z.object({
  isFreeText: z.boolean().default(false),
  itemId: z.string().optional(),
  customItemName: z.string().optional(),
  description: z.string().optional(),
  quantityRequested: z.coerce.number({
    invalid_type_error: 'Quantity must be a valid number',
  }).min(0.01, 'Quantity must be greater than 0'),
  unit: z.string().min(1, 'Unit is required (e.g., pcs, meters, kg)'),
  purpose: z.string().optional(),
  currentStock: z.number().optional().default(0),
  notInInventory: z.boolean().default(false),
}).superRefine((data, ctx) => {
  if (data.isFreeText || data.notInInventory) {
    if (!data.customItemName || data.customItemName.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Please enter item name or specification',
        path: ['customItemName'],
      });
    }
  } else {
    if (!data.itemId || data.itemId.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Please select an item from inventory',
        path: ['itemId'],
      });
    }
  }
});

export const mrsFormSchema = z.object({
  dateRequested: z.string().min(1, 'Date Requested is required'),
  dateNeeded: z.string().min(1, 'Date Needed is required'),
  department: z.string().min(1, 'Requesting Department is required'),
  requestedBy: z.string().min(1, 'Requested By is required'),
  purposeCategory: z.string().min(1, 'Purpose Category is required'),
  workOrderReference: z.string().optional(),
  workOrderId: z.string().optional(),
  preparedBy: z.string().min(1, 'Prepared By is required'),
  items: z.array(mrsItemSchema).min(1, 'At least one material item is required'),
});

export type MRSFormValues = z.infer<typeof mrsFormSchema>;
export type MRSItemFormValue = z.infer<typeof mrsItemSchema>;
