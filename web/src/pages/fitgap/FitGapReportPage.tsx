import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import ComparisonTable from "@/components/fitgap/ComparisonTable";
import LevelBadge from "@/components/portfolio/LevelBadge";
import { portfoliosApi } from "@/services/portfolios";
import { sessionsApi } from "@/services/sessions";
import { fitGapReportSchema } from "@/schemas/portfolio";
import { usePolling } from "@/hooks/usePolling";
import { httpStatus } from "@/lib/httpError";
import { ArrowLeft, Download, Loader2, RefreshCw, Zap } from "lucide-react";
import type { FitGapReport, Portfolio } from "@/types";

// Roughly two minutes of polling before admitting a replacement never landed.
const REPLACEMENT_POLL_LIMIT = 24;

export default function FitGapReportPage() {
  const { id, sessionId, vacancyId } = useParams<{
    id: string;
    sessionId: string;
    vacancyId: string;
  }>();

  const [report, setReport] = useState<FitGapReport | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generationFailed, setGenerationFailed] = useState(false);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"pdf" | "json" | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // A regeneration replaces the report row in place, so polling cannot re-queue
  // and cannot treat the previous report as the new one.
  const queuedRef = useRef(false);
  const replacementAttemptsRef = useRef(0);

  const fetchReport = useCallback(async () => {
    if (!portfolio) return;

    try {
      const res = await portfoliosApi.getFitGap(portfolio.id, Number(vacancyId));
      const parsed = fitGapReportSchema.safeParse(res.data.report);
      if (!parsed.success) {
        console.error("Unexpected fit/gap response shape", parsed.error.issues);
        throw new Error("Unexpected fit/gap response shape");
      }
      const incoming = parsed.data as FitGapReport;

      if (replacing && incoming.generated_at === replacing) {
        replacementAttemptsRef.current += 1;
        if (replacementAttemptsRef.current >= REPLACEMENT_POLL_LIMIT) {
          replacementAttemptsRef.current = 0;
          setReplacing(null);
          setActionError("Regeneration did not finish. The previous report is still shown.");
        }
        return;
      }

      setReport(incoming);
      setReplacing(null);
      replacementAttemptsRef.current = 0;
      setGenerating(false);
      setGenerationFailed(false);
      setLoadError(false);
    } catch (error) {
      if (httpStatus(error) !== 404) {
        setLoadError(true);
        setGenerating(false);
        return;
      }

      // No report row yet: queue exactly once. Polling must never re-queue.
      if (!queuedRef.current) {
        queuedRef.current = true;
        try {
          await portfoliosApi.triggerFitGap(portfolio.id, Number(vacancyId));
          setGenerating(true);
          setLoadError(false);
        } catch {
          queuedRef.current = false;
          setGenerating(false);
          setLoadError(true);
        }
        return;
      }

      // Queued but still absent: generation itself may have failed.
      try {
        const statusRes = await sessionsApi.getPortfolio(Number(sessionId));
        const data: { status?: string; portfolio?: Portfolio } = statusRes.data;

        if (data.portfolio?.generation_status === "failed") {
          setGenerating(false);
          setGenerationFailed(true);
        } else if (data.portfolio?.generation_status === "complete") {
          setPortfolio(data.portfolio);
        }
      } catch {
        // Leave the current state alone; the next tick retries.
      }
    }
  }, [portfolio, vacancyId, sessionId, replacing]);

  useEffect(() => {
    sessionsApi
      .getPortfolio(Number(sessionId))
      .then(async (res) => {
        // Endpoint returns either an in-progress marker or the portfolio payload.
        const data: { status?: string; portfolio?: Portfolio } = res.data;
        if (data.portfolio) {
          setPortfolio(data.portfolio);
        }
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [sessionId, retryCount]);

  useEffect(() => {
    if (portfolio) fetchReport();
  }, [portfolio, fetchReport]);

  usePolling(fetchReport, 5000, (generating || replacing !== null) && !!portfolio);

  const queueReport = async (): Promise<boolean> => {
    if (!portfolio) return false;

    try {
      await portfoliosApi.triggerFitGap(portfolio.id, Number(vacancyId));
      queuedRef.current = true;
      return true;
    } catch {
      return false;
    }
  };

  const handleRetryGeneration = async () => {
    setActionError(null);
    setGenerationFailed(false);
    setGenerating(true);

    if (await queueReport()) return;

    setGenerating(false);
    setGenerationFailed(true);
    setActionError("Could not queue report generation.");
  };

  const handleRegenerate = async () => {
    if (!portfolio) return;
    setRegenerating(true);
    setActionError(null);

    try {
      await portfoliosApi.regenerateFitGap(portfolio.id, Number(vacancyId));
      // Keep the previous report visible until its replacement lands.
      replacementAttemptsRef.current = 0;
      setReplacing(report?.generated_at ?? null);
      setGenerating(report == null);
    } catch {
      setActionError("Could not queue a new report. The previous report is unchanged.");
    } finally {
      setRegenerating(false);
    }
  };

  const handleExport = async (format: "pdf" | "json") => {
    if (!portfolio) return;
    setExporting(format);
    setActionError(null);
    try {
      const res = await portfoliosApi.exportPortfolio(portfolio.id, format, Number(vacancyId));
      const ext = format;
      const blob = format === "pdf"
        ? new Blob([res.data as BlobPart], { type: "application/pdf" })
        : new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fitgap-${sessionId}-${vacancyId}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setActionError("Could not export this report. Retry.");
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  // Overrides are stored on the portfolio, keyed by the skill they correct.
  const overrideBySkillId = new Map(
    (portfolio?.overrides ?? []).map((override) => [override.portfolio_skill_id, override]),
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="sticky top-14 z-30 -mx-4 px-4 py-3 bg-background/95 backdrop-blur border-b flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <Link
              to={`/assessments/${id}/sessions/${sessionId}/portfolio`}
              aria-label="Back to portfolio"
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-lg font-semibold">Fit/Gap Report</h1>
          </div>
        </div>

        {portfolio && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRegenerate} disabled={regenerating || generating}>
              {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              Regenerate
            </Button>
            {report && (
              <>
                <Button variant="outline" size="sm" onClick={() => handleExport("pdf")} disabled={!!exporting}>
                  {exporting === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                  PDF
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleExport("json")} disabled={!!exporting}>
                  {exporting === "json" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                  JSON
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Generating */}
      {generating && (
        <div className="border rounded-lg p-12 text-center space-y-3" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Generating fit/gap report...</p>
        </div>
      )}

      {/* Load failure */}
      {loadError && !generating && (
        <div className="border border-destructive/40 rounded-lg p-6 text-center space-y-3" role="alert">
          <p className="text-sm text-destructive">We could not load this fit/gap report.</p>
          <p className="text-xs text-muted-foreground">
            Nothing was changed. Retry to request the report again.
          </p>
          <Button variant="outline" size="sm" onClick={() => setRetryCount((count) => count + 1)}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
          </Button>
        </div>
      )}

      {/* Generation failure */}
      {generationFailed && !generating && (
        <div className="border border-destructive/40 rounded-lg p-6 text-center space-y-3" role="alert">
          <p className="text-sm text-destructive">Fit/gap generation failed.</p>
          <p className="text-xs text-muted-foreground">
            The portfolio itself is unaffected. Retry to queue the comparison again.
          </p>
          <Button variant="outline" size="sm" onClick={handleRetryGeneration}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
          </Button>
        </div>
      )}

      {/* Action failure */}
      {actionError && (
        <div className="border border-destructive/40 rounded-lg p-4 text-sm text-destructive" role="alert">
          {actionError}
        </div>
      )}

      {/* Regenerating over a valid previous report */}
      {replacing && (
        <div
          className="border rounded-lg p-3 text-xs text-muted-foreground flex items-center gap-2"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Regenerating. The report below is the previous version and stays valid until the replacement lands.
        </div>
      )}

      {/* No report yet */}
      {!generating && !report && !loadError && !generationFailed && portfolio && (
        <div className="border rounded-lg p-8 text-center space-y-2">
          <p className="text-sm font-medium">No fit/gap report yet.</p>
          <p className="text-sm text-muted-foreground">
            Generate a report to compare this portfolio against the vacancy requirements.
          </p>
        </div>
      )}

      {/* Report ready */}
      {report && (
        <>
          {/* Skill comparison */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Skill Comparison</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ComparisonTable comparisons={report.skill_comparisons} />
              {report.override_context.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {report.override_context.map((entry, index) => (
                    <li key={`${entry.skill_id ?? entry.skill_label}-${index}`}>
                      Overrides on skills outside this vacancy: {entry.skill_label} L{entry.override_level}
                      {entry.ai_level !== entry.override_level ? ` (AI rated L${entry.ai_level})` : ""}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground mt-3">
                “Insufficient evidence” means the interview did not produce enough evidence to rate the skill; it is
                not a low rating. “Not assessed” means the skill was never covered in the interview.
              </p>
            </CardContent>
          </Card>

          <Separator />

          {/* Culture & competency */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Culture &amp; Competency Fit</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {report.culture_narrative ? (
                <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                  {report.culture_narrative}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No culture narrative was generated for this report. The skill comparison above is unaffected.
                </p>
              )}
            </CardContent>
          </Card>

          {report.overall_narrative && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Overall Summary</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                  {report.overall_narrative}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Discovered skills */}
          {portfolio && portfolio.skills.some((s) => s.is_discovered) && (
            <>
              <Separator />
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <Zap className="h-4 w-4 text-amber-500" />
                    Discovered Skills (not in vacancy requirements)
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  {portfolio.skills
                    .filter((s) => s.is_discovered)
                    .map((s) => {
                      const override = overrideBySkillId.get(s.id);
                      const effectiveLevel = override?.override_level ?? s.ai_level;

                      return (
                        <div key={s.id} className="text-sm flex flex-wrap items-center gap-2">
                          <span className="font-medium">{s.skill_label}</span>
                          <LevelBadge level={effectiveLevel} size="sm" />
                          {override && (
                            <span className="text-xs font-medium text-green-600">
                              Human override
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {override
                              ? `AI rated L${s.ai_level} — assessor set L${override.override_level}`
                              : s.ai_confidence?.toLowerCase() === "low"
                                ? "low confidence"
                                : "confirmed"}
                          </span>
                          <span className="text-xs text-muted-foreground">— Not required for this role, may be additive.</span>
                        </div>
                      );
                    })}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
