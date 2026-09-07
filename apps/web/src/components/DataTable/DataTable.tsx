import type { ReactNode } from "react";
import "./DataTable.css";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  filter?: ReactNode;
  onSort?: () => void;
  sortDirection?: "ascending" | "descending";
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  numeric?: boolean;
  width?: string;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  onRowClick,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
}) {
  return (
    <div className="data-table">
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th scope="col" aria-sort={col.onSort ? col.sortDirection || "none" : undefined} key={col.key} style={{ width: col.width, textAlign: col.align ?? "left" }}>
                {col.onSort ? <button className="data-table__sort" type="button" onClick={col.onSort} aria-label={`Sort by ${col.header}`}>{col.header}<span aria-hidden="true">{col.sortDirection === "ascending" ? "↑" : col.sortDirection === "descending" ? "↓" : "↕"}</span></button> : col.header}
              </th>
            ))}
          </tr>
          {columns.some((col) => col.filter) && <tr className="data-table__filters">{columns.map((col) => <td key={col.key}>{col.filter}</td>)}</tr>}
        </thead>
        <tbody>
          {!rows.length && <tr><td colSpan={columns.length}>No matching records. Adjust or clear the column filters.</td></tr>}
          {rows.map((row) => (
            <tr
              key={row.id}
              className={onRowClick ? "data-table__row--clickable" : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === "Enter") onRowClick(row);
                    }
                  : undefined
              }
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={col.numeric ? "numeric" : undefined}
                  style={{ textAlign: col.align ?? "left" }}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
