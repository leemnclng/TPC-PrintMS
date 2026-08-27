import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell/AppShell";

import { OverviewPage } from "./pages/OverviewPage";
import { JobOrdersPage } from "./pages/JobOrdersPage";
import { QuotationsPage } from "./pages/QuotationsPage";
import { ProductionPage } from "./pages/ProductionPage";
import { PrintCenterPage } from "./pages/PrintCenterPage";
import { DocumentAnalyzerPage } from "./pages/DocumentAnalyzerPage";
import { InventoryPage } from "./pages/inventory/InventoryPage";
import { ProductCatalogPage } from "./pages/ProductCatalogPage";
import { CustomersPage } from "./pages/CustomersPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ConfigurationPage } from "./pages/ConfigurationPage";

import { JobOrderWorkspace } from "./pages/workspaces/JobOrderWorkspace";
import { QuotationWorkspace } from "./pages/workspaces/QuotationWorkspace";
import { ProductWorkspace } from "./pages/workspaces/ProductWorkspace";
import { ServiceSettingsWorkspace } from "./pages/workspaces/ServiceSettingsWorkspace";
import { VariantsWorkspace } from "./pages/workspaces/ServiceVariantsWorkspace";
import { ServiceWorkspace } from "./pages/workspaces/ServiceWorkspace";
import { CustomerWorkspace } from "./pages/workspaces/CustomerWorkspace";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />

        <Route path="job-orders" element={<JobOrdersPage />} />
        <Route path="job-orders/:jobOrderId" element={<JobOrderWorkspace />} />

        <Route path="quotations" element={<QuotationsPage />} />
        <Route path="quotations/:quotationId" element={<QuotationWorkspace />} />

        <Route path="production" element={<ProductionPage />} />
        <Route path="print-center" element={<PrintCenterPage />} />
        <Route path="document-analyzer" element={<DocumentAnalyzerPage />} />
        <Route path="inventory" element={<InventoryPage />} />

        <Route path="product-catalog" element={<ProductCatalogPage />} />
        <Route path="product-catalog/variants" element={<Navigate to="/configuration/variants" replace />} />
        <Route path="product-catalog/new" element={<ServiceSettingsWorkspace />} />
        <Route path="product-catalog/:serviceId/settings" element={<ServiceSettingsWorkspace />} />
        <Route path="product-catalog/:serviceId" element={<ServiceWorkspace />} />
        <Route path="product-catalog/:serviceId/products/new" element={<ProductWorkspace />} />
        <Route path="product-catalog/:serviceId/products/:productId" element={<ProductWorkspace />} />

        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/new" element={<CustomerWorkspace />} />
        <Route path="customers/:customerId" element={<CustomerWorkspace />} />

        <Route path="reports" element={<ReportsPage />} />
        <Route path="configuration" element={<ConfigurationPage />} />
        <Route path="configuration/variants" element={<VariantsWorkspace />} />
        <Route path="settings" element={<SettingsPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
