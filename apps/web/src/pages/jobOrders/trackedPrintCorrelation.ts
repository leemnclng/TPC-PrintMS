export interface CorrelatableTrackedPrint {
  id: string;
  documentName: string;
  firstSeenAt: string;
}

function normalizedName(documentName: string): string {
  return documentName
    .replace(/\.[^.]+$/, "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function correlationScore(selectedName: string, candidateName: string): number {
  if (!selectedName || !candidateName) return 0;
  if (selectedName === candidateName) return 100;
  if (selectedName.includes(candidateName) || candidateName.includes(selectedName)) return 75;

  const selectedTokens = new Set(selectedName.split(" "));
  const candidateTokens = new Set(candidateName.split(" "));
  const sharedCount = [...selectedTokens].filter((token) => candidateTokens.has(token)).length;
  if (sharedCount < 2) return 0;
  const selectedOverlap = sharedCount / selectedTokens.size;
  const candidateOverlap = sharedCount / candidateTokens.size;
  if (Math.min(selectedOverlap, candidateOverlap) < 0.5) return 0;
  return 50 + selectedOverlap + candidateOverlap;
}

export function groupCorrelatedTrackedPrints<T extends CorrelatableTrackedPrint>(
  selected: CorrelatableTrackedPrint,
  attempts: T[],
): { likelyRelated: T[]; otherAttempts: T[] } {
  const selectedName = normalizedName(selected.documentName);
  const selectedTime = Date.parse(selected.firstSeenAt);
  const ranked = attempts.map((attempt) => ({
    attempt,
    score: correlationScore(selectedName, normalizedName(attempt.documentName)),
    timeDistance: Math.abs(Date.parse(attempt.firstSeenAt) - selectedTime),
  }));
  ranked.sort((left, right) => right.score - left.score || left.timeDistance - right.timeDistance);
  return {
    likelyRelated: ranked.filter(({ score }) => score > 0).map(({ attempt }) => attempt),
    otherAttempts: ranked.filter(({ score }) => score === 0).map(({ attempt }) => attempt),
  };
}
