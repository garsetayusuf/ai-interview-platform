import { LEVEL_LABELS, FIT_GAP_RESULT_LABELS, FIT_GAP_RESULT_CLASSES } from "@/utils/constants";
import { cn } from "@/lib/utils";
import type { SkillComparison } from "@/types";

interface ComparisonTableProps {
  comparisons: SkillComparison[];
}

const ASSESSMENT_STATE_LABELS: Record<SkillComparison["assessment_state"], string> = {
  assessed: "Assessed",
  insufficient_evidence: "Insufficient evidence",
  not_assessed: "Not assessed",
};

const SOURCE_LABELS: Record<string, string> = {
  ai: "AI rating",
  assessor_override: "Human override",
};

function ResultBadge({ comparison }: { comparison: SkillComparison }) {
  const label = FIT_GAP_RESULT_LABELS[comparison.result];
  const classes = FIT_GAP_RESULT_CLASSES[comparison.result];

  let icon = "";
  let suffix = "";
  if (comparison.result === "match") icon = "✅";
  else if (comparison.result === "exceed") {
    icon = "⭐";
    suffix = comparison.delta != null ? ` +${comparison.delta}` : "";
  } else if (comparison.result === "gap") {
    icon = "⚠";
    suffix = comparison.delta != null ? ` -${Math.abs(comparison.delta)}` : "";
  } else icon = "—";

  const notAssessedLabel =
    comparison.assessment_state === "insufficient_evidence"
      ? "Insufficient evidence"
      : comparison.assessment_state === "not_assessed"
      ? "Not assessed"
      : null;

  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded", classes)}>
        {icon} {label}
        {suffix}
      </span>
      {notAssessedLabel && (
        <span className="text-xs text-muted-foreground">{notAssessedLabel}</span>
      )}
    </span>
  );
}

export default function ComparisonTable({ comparisons }: ComparisonTableProps) {
  // Summary counts
  const matchCount = comparisons.filter((c) => c.result === "match").length;
  const gapCount = comparisons.filter((c) => c.result === "gap").length;
  const exceedCount = comparisons.filter((c) => c.result === "exceed").length;
  const insufficientCount = comparisons.filter(
    (c) => c.assessment_state === "insufficient_evidence"
  ).length;
  const notAssessedCount = comparisons.filter(
    (c) => c.assessment_state === "not_assessed"
  ).length;
  const overrideCount = comparisons.filter((c) => c.is_override).length;

  const summaryParts = [
    matchCount > 0 ? `Match: ${matchCount} skill${matchCount !== 1 ? "s" : ""}` : null,
    gapCount > 0 ? `Gap: ${gapCount} skill${gapCount !== 1 ? "s" : ""}` : null,
    exceedCount > 0 ? `Exceeds: ${exceedCount} skill${exceedCount !== 1 ? "s" : ""}` : null,
    insufficientCount > 0
      ? `Insufficient evidence: ${insufficientCount} skill${insufficientCount !== 1 ? "s" : ""}`
      : null,
    notAssessedCount > 0
      ? `Not assessed: ${notAssessedCount} skill${notAssessedCount !== 1 ? "s" : ""}`
      : null,
    overrideCount > 0
      ? `Human override applied: ${overrideCount} skill${overrideCount !== 1 ? "s" : ""}`
      : null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Skill comparison: vacancy requirement, candidate level, and fit result
          </caption>
          <thead>
            <tr className="border-b bg-muted/50">
              <th scope="col" className="text-left px-4 py-2.5 font-medium">Skill</th>
              <th scope="col" className="text-center px-4 py-2.5 font-medium">Required</th>
              <th scope="col" className="text-center px-4 py-2.5 font-medium">Candidate</th>
              <th scope="col" className="text-center px-4 py-2.5 font-medium">Result</th>
              <th scope="col" className="text-center px-4 py-2.5 font-medium">Evidence state</th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map((c, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="px-4 py-2.5">{c.skill_label}</td>
                <td className="px-4 py-2.5 text-center text-muted-foreground">
                  {c.required_level != null ? LEVEL_LABELS[c.required_level] : "—"}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {c.candidate_level != null ? (
                    <span>
                      {LEVEL_LABELS[c.candidate_level]}
                      {c.is_override && (
                        <span className="text-xs text-muted-foreground ml-1" title="Human override applied">
                          ✏
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <ResultBadge comparison={c} />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-xs font-medium">
                      {ASSESSMENT_STATE_LABELS[c.assessment_state] ?? c.assessment_state}
                    </span>
                    {c.candidate_level_source && (
                      <span className="text-xs text-muted-foreground">
                        {SOURCE_LABELS[c.candidate_level_source] ?? c.candidate_level_source}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {summaryParts.map((part) => (
          <span key={part}>{part}</span>
        ))}
        <span className="ml-auto">✏ = human override applied</span>
      </div>
    </div>
  );
}
