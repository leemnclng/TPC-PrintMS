import { useEffect, useState } from "react";
import type { JobOrder } from "../../types/domain";

export function usePaperUsage(order: JobOrder, open: boolean) {
  const [values, setValues] = useState<Record<string, string>>({});
  const plans = order.items.flatMap((item) => item.materials.filter((plan) => plan.paperSize).map((plan) => ({ ...plan, productName: item.productName })));
  useEffect(() => {
    if (open) setValues({});
  }, [open, order.id]);
  const valid = plans.every((plan) => values[plan.id]?.trim() && Number.isFinite(Number(values[plan.id])) && Number(values[plan.id]) >= 0);
  const payload = plans.map((plan) => ({ materialPlanId: plan.id, trackedQuantity: plan.consumedQuantity, actualQuantity: Number(values[plan.id]) }));
  const fields = <fieldset className="paper-usage-confirmation" disabled={!open}>
    <legend>Confirm paper used</legend>
    <p>Enter the total used for each product, including wasted sheets and all reprints. Use 0 if no paper was used. Only the difference from tracked usage adjusts stock.</p>
    {!plans.length && <p>No paper materials are assigned to this transaction.</p>}
    {plans.map((plan) => {
      const value = values[plan.id] ?? "";
      const delta = Number(value) - plan.consumedQuantity;
      return <label className="form-field" key={plan.id}>
        <span>{plan.productName} · {plan.inventoryItemName} — actual {plan.inventoryItemUnit} used (required)</span>
        <input type="number" required min="0" step="any" value={value} onChange={(event) => setValues((current) => ({ ...current, [plan.id]: event.target.value }))} aria-describedby={`paper-${plan.id}`} />
        <small id={`paper-${plan.id}`}>Tracked: {plan.consumedQuantity} {plan.inventoryItemUnit}. {value !== "" && Number.isFinite(delta) && Number(value) >= 0 ? delta === 0 ? "Matches tracked usage; no stock change." : delta > 0 ? `Deduct ${delta} more.` : `Return ${-delta} unused to stock.` : "Enter the actual amount to compare."}</small>
      </label>;
    })}
  </fieldset>;
  return { valid, payload, fields };
}
