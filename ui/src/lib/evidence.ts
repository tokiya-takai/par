import type { Answer, Comment, EvidenceStrength } from "../types";

/**
 * The two-sided-anchor check, mirrored from the server so reloaded comments
 * (whose `evidence` the API omits) render identically to a live answer. An
 * answer is "sufficient" only if it cites code, and — when the question carried
 * reference URLs — the reference it was checked against.
 */
export function evidenceStrength(referenceUrlCount: number, answer: Answer): EvidenceStrength {
  const hasCode = answer.codeAnchors.length > 0;
  const needsSource = referenceUrlCount > 0;
  const ok = hasCode && (!needsSource || answer.sourceAnchors.length > 0);
  return ok ? "sufficient" : "insufficient";
}

/** Evidence strength for a comment's latest answer. */
export function evidenceForComment(comment: Comment, answer: Answer): EvidenceStrength {
  return evidenceStrength(comment.referenceUrls.length, answer);
}
