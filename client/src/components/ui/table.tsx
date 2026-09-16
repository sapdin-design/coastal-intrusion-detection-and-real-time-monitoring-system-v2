import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/format';
import { EmptyState, SkeletonTable } from './base';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Providing this makes the column sortable. */
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right' | 'center';
  className?: string;
  headerClassName?: string;
  width?: string;
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  initialSortKey?: string;
  initialSortDir?: 'asc' | 'desc';
  /** Sticky header with a bounded scroll area, for dense operational tables. */
  maxHeight?: string;
  rowClassName?: (row: T) => string | undefined;
  dense?: boolean;
  className?: string;
}

const alignClass = (align: Column<unknown>['align']): string =>
  align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

/**
 * Generic, sortable data table.
 *
 * Sorting is client-side on purpose: the operational tables hold at most a few
 * hundred rows (the API caps at 2 000) and instant sort beats a network round-trip
 * during an incident. Pagination is offered separately via `Pagination`.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading = false,
  emptyTitle = 'Nothing to show',
  emptyDescription,
  emptyAction,
  initialSortKey,
  initialSortDir = 'desc',
  maxHeight,
  rowClassName,
  dense = false,
  className,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | undefined>(initialSortKey);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSortDir);

  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === sortKey);
    if (!column?.sortValue) return rows;
    const factor = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = column.sortValue!(a);
      const bv = column.sortValue!(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * factor;
    });
  }, [rows, columns, sortKey, sortDir]);

  const toggleSort = (column: Column<T>) => {
    if (!column.sortValue) return;
    if (sortKey === column.key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(column.key);
    setSortDir('desc');
  };

  if (loading) return <SkeletonTable rows={7} cols={Math.min(columns.length, 6)} />;

  if (!rows.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  return (
    <div className={cn('w-full overflow-auto', className)} style={maxHeight ? { maxHeight } : undefined}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sortKey === column.key;
              return (
                <th
                  key={column.key}
                  style={column.width ? { width: column.width } : undefined}
                  className={cn(alignClass(column.align), column.headerClassName)}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      className={cn(
                        'inline-flex items-center gap-1 transition-colors hover:text-slate-800',
                        active && 'text-brand-700',
                      )}
                    >
                      {column.header}
                      {active ? (
                        sortDir === 'asc' ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(onRowClick && 'cursor-pointer', rowClassName?.(row))}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    alignClass(column.align),
                    dense && 'py-1.5',
                    column.className,
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────────────────────── Pagination ───────────────────────────── */

export function Pagination({
  page,
  pages,
  total,
  limit,
  onPageChange,
  className,
}: {
  page: number;
  pages: number;
  total: number;
  limit: number;
  onPageChange: (next: number) => void;
  className?: string;
}) {
  if (total === 0) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className={cn('flex items-center justify-between gap-3 px-3 py-2.5', className)}>
      <p className="tnum text-xs text-slate-500">
        Showing <span className="font-semibold text-slate-700">{from}</span>–
        <span className="font-semibold text-slate-700">{to}</span> of{' '}
        <span className="font-semibold text-slate-700">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="btn btn-secondary btn-xs"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="tnum px-2 text-xs text-slate-600">
          Page {page} / {pages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(pages, page + 1))}
          disabled={page >= pages}
          className="btn btn-secondary btn-xs"
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
