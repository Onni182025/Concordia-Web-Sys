'use client';

import { Button } from '@/components/ui/button';

type TablePaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
};

export function TablePagination({ page, pageSize, total, onPageChange }: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);
  const startPage = Math.max(1, Math.min(page - 2, totalPages - 4));
  const pages = Array.from({ length: Math.min(totalPages, 5) }, (_, index) => startPage + index);

  return (
    <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
      <span>Showing {firstItem.toLocaleString()}–{lastItem.toLocaleString()} of {total.toLocaleString()}</span>
      <nav aria-label="Table pagination" className="flex items-center gap-1">
        <Button type="button" size="sm" variant="outline" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          Previous
        </Button>
        {pages.map(pageNumber => (
          <Button
            key={pageNumber}
            type="button"
            size="sm"
            variant={pageNumber === page ? 'default' : 'outline'}
            className={pageNumber === page ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''}
            aria-current={pageNumber === page ? 'page' : undefined}
            onClick={() => onPageChange(pageNumber)}
          >
            {pageNumber}
          </Button>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
          Next
        </Button>
      </nav>
    </div>
  );
}
