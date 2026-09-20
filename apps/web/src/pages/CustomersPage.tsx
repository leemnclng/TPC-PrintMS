import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader/PageHeader";
import { DataTable, DataTableColumn } from "../components/DataTable/DataTable";
import { LinkButton } from "../components/Button/LinkButton";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { ErrorState } from "../components/ErrorState/ErrorState";
import { Pagination } from "../components/Pagination/Pagination";
import { usePaginatedResource } from "../hooks/usePaginatedResource";
import { api } from "../lib/apiClient";
import type { Customer, PaginatedResponse } from "../types/domain";

const CHANNEL_LABEL: Record<Customer["sourceChannel"], string> = {
  messenger: "Messenger",
  gmail: "Gmail",
  form: "Form",
  walk_in: "Walk-in",
  phone: "Phone",
  other: "Other",
};

export function CustomersPage() {
  const navigate = useNavigate();
  const { data, state, error, reload, setPage, setPageSize, pageLoading } = usePaginatedResource<Customer>(
    (page, pageSize) => api.get<PaginatedResponse<Customer>>(`/customers/page?page=${page}&page_size=${pageSize}`),
    "customers",
  );

  const columns: DataTableColumn<Customer>[] = [
    { key: "name", header: "Customer", render: (r) => r.displayName },
    { key: "contact", header: "Contact", render: (r) => r.email ?? r.phone ?? "—" },
    { key: "channel", header: "Source", render: (r) => CHANNEL_LABEL[r.sourceChannel] },
    { key: "orders", header: "Job orders", numeric: true, align: "right", render: (r) => r.jobOrderCount },
  ];

  return (
    <>
      <PageHeader
        eyebrow="CUSTOMERS"
        title="Customers"
        description="Contact details and job history for every customer — however they first reached out."
        actions={
          <LinkButton variant="primary" to="/customers/new">
            New customer
          </LinkButton>
        }
      />

      {state === "loading" && <LoadingState label="Loading customers…" />}
      {state === "error" && <ErrorState description={error ?? undefined} onRetry={reload} />}

      {state === "ready" && data && data.total === 0 && (
        <EmptyState
          title="No customers yet"
          description="Messenger, Gmail, and form intake are recorded manually for now — add the customer here once you hear from them."
          action={
            <LinkButton variant="secondary" to="/customers/new">
              New customer
            </LinkButton>
          }
        />
      )}

      {state === "ready" && data && data.total > 0 && (
        <>
          <DataTable columns={columns} rows={data.items} onRowClick={(row) => navigate(`/customers/${row.id}`)} />
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} totalPages={data.totalPages} loading={pageLoading} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="customers" />
        </>
      )}
    </>
  );
}
