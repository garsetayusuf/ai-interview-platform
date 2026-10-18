import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { portfolioSchema } from "@/schemas/portfolio";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import SkillPortfolioCard from "@/components/portfolio/SkillPortfolioCard";
import { sessionsApi } from "@/services/sessions";
import { vacanciesApi } from "@/services/vacancies";
import { portfoliosApi } from "@/services/portfolios";
import { usePolling } from "@/hooks/usePolling";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Zap,
  FileText,
} from "lucide-react";
import type { Portfolio, AssessorOverride, Vacancy, FitGapReport } from "@/types";

function formatTimestamp(value?: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString();
}

export default function PortfolioPage() {
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [overrides, setOverrides] = useState<Record<number, AssessorOverride>>(
    {},
  );
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [selectedVacancy, setSelectedVacancy] = useState<string>("");
  const [existingReport, setExistingReport] = useState<FitGapReport | null>(null);
  const [checkingReport, setCheckingReport] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "json" | null>(null);
  const [candidateName, setCandidateName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const fetchPortfolio = useCallback(async () => {
    const res = await sessionsApi.getPortfolio(Number(sessionId));
    // Endpoint returns either an in-progress marker or the portfolio payload.
    const data: { status?: string; portfolio?: Portfolio } = res.data;
    if (
      data.status === "generating" ||
      data.portfolio?.generation_status === "generating" ||
      data.portfolio?.generation_status === "pending"
    ) {
      setGenerating(true);
    } else if (data.portfolio) {
      const parsed = portfolioSchema.safeParse(data.portfolio);
      if (!parsed.success) {
        console.error("Unexpected portfolio response shape", parsed.error.issues);
        throw new Error("Unexpected portfolio response shape");
      }
      const validated = parsed.data as Portfolio;
      setPortfolio(validated);
      setGenerating(false);
      const overrideMap: Record<number, AssessorOverride> = {};
      validated.overrides.forEach((o: AssessorOverride) => {
        overrideMap[o.portfolio_skill_id] = o;
      });
      setOverrides(overrideMap);
    }
  }, [sessionId]);

  useEffect(() => {
    setLoadError(false);
    Promise.all([
      fetchPortfolio(),
      vacanciesApi.list(),
      sessionsApi.get(Number(sessionId)),
    ])
      .then(([, vRes, sRes]) => {
        setVacancies(vRes.data.vacancies);
        setCandidateName(sRes.data.session.candidate_name ?? null);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [fetchPortfolio, sessionId, retryCount]);

  // Poll while generating
  usePolling(fetchPortfolio, 5000, generating);

  // An existing comparison is only discoverable by asking for it: the endpoint
  // answers 404 when nothing has been generated for the selected vacancy yet.
  useEffect(() => {
    if (!portfolio || !selectedVacancy) {
      setExistingReport(null);
      return;
    }

    let cancelled = false;
    setCheckingReport(true);
    portfoliosApi
      .getFitGap(portfolio.id, Number(selectedVacancy))
      .then((res) => {
        if (!cancelled) setExistingReport(res.data.report);
      })
      .catch(() => {
        if (!cancelled) setExistingReport(null);
      })
      .finally(() => {
        if (!cancelled) setCheckingReport(false);
      });

    return () => {
      cancelled = true;
    };
  }, [portfolio, selectedVacancy]);

  const handleOverrideSaved = (skillId: number, override: AssessorOverride) => {
    setOverrides((prev) => ({ ...prev, [skillId]: override }));
  };

  const handleRunFitGap = () => {
    if (!selectedVacancy || !portfolio || isNavigating) return;
    setIsNavigating(true);
    navigate(
      `/assessments/${id}/sessions/${sessionId}/fitgap/${selectedVacancy}`,
    );
  };

  const handleExport = async (format: "pdf" | "json") => {
    if (!portfolio) return;
    setExporting(format);
    try {
      const res = await portfoliosApi.exportPortfolio(
        portfolio.id,
        format,
        selectedVacancy ? Number(selectedVacancy) : undefined,
      );
      if (format === "json") {
        const blob = new Blob([JSON.stringify(res.data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `portfolio-${sessionId}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const blob = new Blob([res.data as BlobPart], {
          type: "application/pdf",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `portfolio-${sessionId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (loadError && !portfolio) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <h1 className="text-lg font-semibold">Portfolio Results</h1>
        <div
          className="border border-destructive/40 rounded-lg p-6 text-center space-y-3"
          role="alert"
        >
          <p className="text-sm text-destructive">
            We could not load this portfolio.
          </p>
          <p className="text-xs text-muted-foreground">
            Nothing is lost. Retry to request the report again.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRetryCount((count) => count + 1)}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  if (
    portfolio?.generation_status === "complete" &&
    portfolio.skills.length === 0
  ) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-2">
          <Link
            to={`/assessments/${id}`}
            aria-label="Back to assessment"
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-lg font-semibold">Portfolio Results</h1>
        </div>
        <div className="border rounded-lg p-8 text-center space-y-2">
          <p className="text-sm font-medium">
            No skills were captured for this session.
          </p>
          <p className="text-sm text-muted-foreground">
            The interview produced no assessable skill evidence, so there is
            nothing to compare against a vacancy.
          </p>
        </div>
      </div>
    );
  }

  const reportIsReady = portfolio?.generation_status === "complete";
  const generatingStatusText = generating
    ? "Generating…"
    : portfolio?.generation_status === "failed"
      ? "Generation failed"
      : reportIsReady
        ? `Generated ${formatTimestamp(portfolio?.generated_at) ?? ""}`.trim()
        : "";

  const fitGapStatus = generating
    ? "The comparison can run once generation finishes."
    : vacancies.length === 0
      ? "No vacancies yet. Create one to compare this portfolio."
      : !selectedVacancy
        ? "Choose a vacancy to compare"
        : checkingReport
          ? "Checking for an existing report…"
          : existingReport
            ? `Report available · generated ${formatTimestamp(existingReport.generated_at) ?? "earlier"}.`
            : "A comparison will be generated when you open the report.";

  const exportActions = (stacked: boolean) => {
    const stackedClass = stacked ? "w-full justify-start min-h-11" : "";
    return (
      <>
        <Link
          to={`/assessments/${id}/sessions/${sessionId}/transcript`}
          className={cn(
            "inline-flex items-center gap-1 text-sm border rounded-md px-3 py-1.5 hover:bg-accent transition-colors",
            stackedClass,
          )}
        >
          <FileText className="h-3.5 w-3.5" />
          Transcript
        </Link>
        {portfolio && (
          <>
            <Button variant="outline" size="sm" className={stackedClass} onClick={() => handleExport("pdf")} disabled={!!exporting}>
              {exporting === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
              PDF
            </Button>
            <Button variant="outline" size="sm" className={stackedClass} onClick={() => handleExport("json")} disabled={!!exporting}>
              {exporting === "json" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
              JSON
            </Button>
          </>
        )}
      </>
    );
  };

  const compareControl = (stacked: boolean) => {
    const stackedClass = stacked ? "w-full justify-start min-h-11" : "";
    return (
      (generating || reportIsReady) && (
        <div className={cn("space-y-1", stacked && "w-full")}>
          <Label htmlFor="fitgap-vacancy" className="text-xs font-medium text-muted-foreground">
            Compare against
          </Label>
          <div className={cn("flex items-center gap-2", stacked ? "flex-col items-stretch" : "flex-wrap")}>
            <Select value={selectedVacancy} onValueChange={setSelectedVacancy}>
              <SelectTrigger id="fitgap-vacancy" aria-label={`Compare against vacancy, ${vacancies.length} available`} className="w-full sm:w-64">
                <SelectValue placeholder="Choose vacancy..." />
                {vacancies.length > 0 && <span className="ml-auto text-xs text-muted-foreground">{vacancies.length}</span>}
              </SelectTrigger>
              <SelectContent>
                {vacancies.length === 0 ? (
                  <div className="px-2 py-3 text-sm text-muted-foreground">
                    No vacancies yet. <Link to="/vacancies/new" className="underline">Create a vacancy</Link>
                  </div>
                ) : vacancies.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.role_title}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className={cn("flex items-center gap-2", stacked ? "flex-col items-stretch" : "flex-wrap")}>
              {existingReport ? (
                <Button variant="secondary" size="sm" className={stackedClass} onClick={handleRunFitGap} disabled={isNavigating}>
                  Open Fit/Gap Report <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              ) : (
                <Button size="sm" className={stackedClass} onClick={handleRunFitGap} disabled={!selectedVacancy || isNavigating || generating}>
                  {generating ? "Generating…" : <>Generate Fit/Gap Analysis <ArrowRight className="h-3.5 w-3.5 ml-1" /></>}
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">{fitGapStatus}</p>
        </div>
      )
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Sticky action bar: every action stays reachable while the results scroll. */}
      <div
        data-testid="portfolio-action-bar"
        className="sticky top-14 z-30 -mx-4 px-4 py-3 bg-background/95 backdrop-blur border-b space-y-3"
      >
        <div className="flex items-start gap-2">
          <Link
            to={`/assessments/${id}`}
            aria-label="Back to assessment"
            className="mt-0.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">Portfolio Results</h1>
            {candidateName && <p className="text-sm text-muted-foreground truncate">{candidateName}</p>}
            {generatingStatusText && <p className="text-xs text-muted-foreground">{generatingStatusText}</p>}
          </div>
          <div className="hidden sm:flex flex-wrap items-center justify-end gap-2">
            {exportActions(false)}
          </div>
          <div className="sm:hidden shrink-0">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="min-h-11">
                  <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
                  Actions
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="space-y-4">
                <SheetHeader><SheetTitle>Portfolio actions</SheetTitle></SheetHeader>
                <div className="flex flex-col gap-2">
                  {exportActions(true)}
                  {compareControl(true)}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
        <div className="hidden sm:block border-t pt-3">
          {compareControl(false)}
        </div>
      </div>

      {/* Generating state */}
      {generating && (
        <div
          className="border rounded-lg p-12 text-center space-y-3"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <div>
            <p className="font-medium">Generating portfolio...</p>
            <p className="text-sm text-muted-foreground mt-1">
              The AI is analyzing the interview transcript. This takes about 2
              minutes.
            </p>
          </div>
        </div>
      )}

      {/* Failed state */}
      {!generating && portfolio?.generation_status === "failed" && (
        <div className="border border-destructive/40 rounded-lg p-6 text-center space-y-3">
          <p className="text-sm text-destructive">
            Portfolio generation failed.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await sessionsApi.regeneratePortfolio(Number(sessionId));
              setGenerating(true);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
          </Button>
        </div>
      )}

      {/* Ready state */}
      {!generating && reportIsReady && portfolio && (
        <>
          {/* Configured skills */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Configured Skills</h2>
            {portfolio.skills
              .filter((s) => !s.is_discovered)
              .map((skill) => (
                <SkillPortfolioCard
                  key={skill.id}
                  skill={skill}
                  override={overrides[skill.id]}
                  onOverrideSaved={(o) => handleOverrideSaved(skill.id, o)}
                />
              ))}
          </div>

          {/* Discovered skills */}
          {portfolio.skills.some((s) => s.is_discovered) && (
            <>
              <Separator />
              <div className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold flex items-center gap-1.5">
                    <Zap className="h-4 w-4 text-amber-500" />
                    Discovered Skills
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Skills the AI probed that were not in the original
                    assessment
                  </p>
                </div>
                {portfolio.skills
                  .filter((s) => s.is_discovered)
                  .map((skill) => (
                    <SkillPortfolioCard
                      key={skill.id}
                      skill={skill}
                      override={overrides[skill.id]}
                      onOverrideSaved={(o) => handleOverrideSaved(skill.id, o)}
                    />
                  ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
