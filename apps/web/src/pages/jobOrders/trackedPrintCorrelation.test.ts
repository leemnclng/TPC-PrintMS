import assert from "node:assert/strict";
import test from "node:test";

import { groupCorrelatedTrackedPrints } from "./trackedPrintCorrelation.ts";


test("groups case-insensitive filename matches before unrelated attempts", () => {
  const selected = {
    id: "accepted",
    documentName: "Santos Thesis FINAL.PDF",
    firstSeenAt: "2026-09-26T12:00:00Z",
  };
  const attempts = [
    { id: "unrelated", documentName: "Passport Photo.jpg", firstSeenAt: "2026-09-26T11:59:00Z" },
    { id: "word-match", documentName: "santos_thesis_draft.pdf", firstSeenAt: "2026-09-26T11:30:00Z" },
    { id: "exact", documentName: "sAnToS tHeSiS fInAl.pdf", firstSeenAt: "2026-09-26T10:00:00Z" },
  ];

  const grouped = groupCorrelatedTrackedPrints(selected, attempts);

  assert.deepEqual(grouped.likelyRelated.map((attempt) => attempt.id), ["exact", "word-match"]);
  assert.deepEqual(grouped.otherAttempts.map((attempt) => attempt.id), ["unrelated"]);
});
