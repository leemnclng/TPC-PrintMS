import { Button } from "../Button/Button";
import "./Pagination.css";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  itemLabel?: string;
}

export function Pagination({ page, pageSize, total, totalPages, loading, onPageChange, onPageSizeChange, itemLabel = "records" }: PaginationProps) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <nav className="pagination" aria-label={`${itemLabel} pages`} aria-busy={loading || undefined}>
      <p className="pagination__range" aria-live="polite">
        <span className="numeric">{first}–{last}</span> of <span className="numeric">{total}</span> {itemLabel}
      </p>
      <label className="pagination__size">
        <span>Rows</span>
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} disabled={loading}>
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </label>
      <div className="pagination__steps">
        <Button type="button" variant="ghost" size="sm" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>Previous</Button>
        <span className="numeric" aria-current="page">Page {page} / {totalPages}</span>
        <Button type="button" variant="ghost" size="sm" disabled={page >= totalPages || loading} onClick={() => onPageChange(page + 1)}>Next</Button>
      </div>
    </nav>
  );
}
