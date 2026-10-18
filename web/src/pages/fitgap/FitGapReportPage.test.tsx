import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import FitGapReportPage from "@/pages/fitgap/FitGapReportPage";
import { sessionsApi } from "@/services/sessions";
import { portfoliosApi } from "@/services/portfolios";
import type { FitGapReport, Portfolio } from "@/types";

vi.mock("@/services/sessions", () => ({
    sessionsApi: { getPortfolio: vi.fn(), get: vi.fn() },
}));

vi.mock("@/services/portfolios", () => ({
    portfoliosApi: {
        getFitGap: vi.fn(),
        exportPortfolio: vi.fn(),
        triggerFitGap: vi.fn(),
        regenerateFitGap: vi.fn(),
    },
}));

const PORTFOLIO: Portfolio = {
    id: 7,
    session_id: 2,
    generation_status: "complete",
    generated_at: "2026-10-18T10:00:00.000Z",
    skills: [],
    overrides: [],
};

const REPORT: FitGapReport = {
    id: 9,
    portfolio_id: 7,
    vacancy_id: 2,
    skill_comparisons: [
        {
            skill_label: "React",
            required_level: 4,
            candidate_level: 3,
            result: "gap",
            delta: -1,
            assessment_state: "assessed",
            is_override: false,
            candidate_level_source: "ai",
        },
    ],
    culture_narrative: "Culture fit narrative.",
    overall_narrative: "Overall narrative.",
    override_context: [],
    generated_at: "2026-10-18T11:00:00.000Z",
};

function renderPage() {
    return render(
        <MemoryRouter initialEntries={["/assessments/2/sessions/2/fitgap/2"]}>
            <Routes>
                <Route
                    path="/assessments/:id/sessions/:sessionId/fitgap/:vacancyId"
                    element={<FitGapReportPage />}
                />
            </Routes>
        </MemoryRouter>
    );
}

describe("FitGapReportPage failure handling", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(sessionsApi.getPortfolio).mockResolvedValue({
            data: { portfolio: PORTFOLIO },
        } as never);
        vi.mocked(portfoliosApi.getFitGap).mockResolvedValue({ data: { report: REPORT } } as never);
    });

    it("says so when an export fails instead of failing silently", async () => {
        vi.mocked(portfoliosApi.exportPortfolio).mockRejectedValue(new Error("offline"));
        renderPage();

        await screen.findByText("Skill Comparison");
        fireEvent.click(screen.getByRole("button", { name: "PDF" }));

        await waitFor(() =>
            expect(screen.getByRole("alert")).toHaveTextContent("Could not export this report. Retry.")
        );
    });

    it("clears a previous export error before the next attempt", async () => {
        vi.mocked(portfoliosApi.exportPortfolio)
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValue({ data: {} } as never);
        renderPage();

        await screen.findByText("Skill Comparison");
        fireEvent.click(screen.getByRole("button", { name: "JSON" }));
        await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

        fireEvent.click(screen.getByRole("button", { name: "JSON" }));

        await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });

    it('reports a load failure with retry', async () => {
        vi.mocked(sessionsApi.getPortfolio).mockRejectedValue(new Error("offline"));
        renderPage();

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "We could not load this fit/gap report."
        );
        expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
    });

    it('shows an assessor override on a discovered skill instead of the AI level alone', async () => {
        vi.mocked(sessionsApi.getPortfolio).mockResolvedValue({
            data: {
                portfolio: {
                    ...PORTFOLIO,
                    skills: [
                        {
                            id: 41,
                            skill_label: "Terraform",
                            is_discovered: true,
                            ai_level: 2,
                            ai_confidence: "medium",
                            assessment_state: "assessed",
                            evidence: [],
                            competency_summary: "",
                        },
                    ],
                    overrides: [
                        {
                            id: 3,
                            portfolio_skill_id: 41,
                            ai_level: 2,
                            override_level: 5,
                            assessor_notes: "Synthetic note.",
                            overridden_by: 7001,
                            overridden_at: "2026-10-18T12:00:00.000Z",
                        },
                    ],
                },
            },
        } as never);

        renderPage();

        expect(await screen.findByText("Terraform")).toBeInTheDocument();
        expect(screen.getByText("Human override")).toBeInTheDocument();
        expect(screen.getByText("L5")).toBeInTheDocument();
        expect(screen.getByText("AI rated L2 — assessor set L5")).toBeInTheDocument();
    });

    it('lists overrides that fall outside the vacancy', async () => {
        vi.mocked(portfoliosApi.getFitGap).mockResolvedValue({
            data: {
                report: {
                    ...REPORT,
                    override_context: [
                        { skill_label: "Communication", skill_id: "communication", ai_level: 2, override_level: 5 },
                    ],
                },
            },
        } as never);

        renderPage();

        const note = await screen.findByText(/Overrides on skills outside this vacancy/);
        expect(note).toHaveTextContent(
            "Overrides on skills outside this vacancy: Communication L5 (AI rated L2)"
        );
    });

    it('does not invent an override note when every override is compared', async () => {
        renderPage();

        await screen.findByText("Skill Comparison");

        expect(screen.queryByText(/Overrides on skills outside this vacancy/)).not.toBeInTheDocument();
    });
});

describe("FitGapReportPage report lifecycle", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(sessionsApi.getPortfolio).mockResolvedValue({
            data: { portfolio: PORTFOLIO },
        } as never);
        vi.mocked(portfoliosApi.getFitGap).mockResolvedValue({ data: { report: REPORT } } as never);
    });

    // Under fake timers the chained load -> lookup -> queue promises settle on
    // microtasks only, so flush them explicitly instead of waiting on timers.
    async function flush() {
        await act(async () => {});
    }

    it("holds the page in a loading placeholder until the portfolio arrives", async () => {
        renderPage();

        // The request has not settled yet, so no page content is on screen.
        expect(screen.queryByRole("heading", { name: "Fit/Gap Report" })).not.toBeInTheDocument();

        expect(await screen.findByRole("heading", { name: "Fit/Gap Report" })).toBeInTheDocument();
        expect(await screen.findByText("Skill Comparison")).toBeInTheDocument();
    });

    it("says no report exists yet while the first lookup is still unanswered", async () => {
        vi.mocked(portfoliosApi.getFitGap).mockRejectedValue({ response: { status: 404 } });
        // A request that never answers holds the page in its pre-report state.
        vi.mocked(portfoliosApi.triggerFitGap).mockReturnValue(new Promise<never>(() => {}) as never);

        renderPage();

        expect(await screen.findByText("No fit/gap report yet.")).toBeInTheDocument();
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
        expect(portfoliosApi.triggerFitGap).toHaveBeenCalledTimes(1);
    });

    it("announces the queued generation through a live region", async () => {
        vi.mocked(portfoliosApi.getFitGap).mockRejectedValue({ response: { status: 404 } });
        vi.mocked(portfoliosApi.triggerFitGap).mockResolvedValue({ data: {} } as never);

        renderPage();

        const generating = await screen.findByRole("status");
        expect(generating).toHaveAttribute("aria-live", "polite");
        expect(generating).toHaveTextContent("Generating fit/gap report...");
        expect(portfoliosApi.triggerFitGap).toHaveBeenCalledTimes(1);
        expect(portfoliosApi.triggerFitGap).toHaveBeenCalledWith(7, 2);
    });

    it("reports a failed generation and requeues the comparison on retry", async () => {
        vi.useFakeTimers();
        try {
            let portfolioLookups = 0;
            vi.mocked(sessionsApi.getPortfolio).mockImplementation(async () => {
                portfolioLookups += 1;
                return portfolioLookups === 1
                    ? ({ data: { portfolio: PORTFOLIO } } as never)
                    : ({ data: { portfolio: { ...PORTFOLIO, generation_status: "failed" } } } as never);
            });
            vi.mocked(portfoliosApi.getFitGap).mockRejectedValue({ response: { status: 404 } });
            vi.mocked(portfoliosApi.triggerFitGap).mockResolvedValue({ data: {} } as never);

            renderPage();
            await flush();
            await flush();
            await flush();

            expect(screen.getByRole("status")).toHaveTextContent("Generating fit/gap report...");

            await act(async () => {
                vi.advanceTimersByTime(5000);
            });
            await flush();
            await flush();

            expect(screen.getByRole("alert")).toHaveTextContent("Fit/gap generation failed.");
            expect(screen.queryByRole("status")).not.toBeInTheDocument();

            await act(async () => {
                fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
            });
            await flush();

            expect(screen.queryByText("Fit/gap generation failed.")).not.toBeInTheDocument();
            expect(screen.getByRole("status")).toHaveTextContent("Generating fit/gap report...");
            expect(portfoliosApi.triggerFitGap).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("keeps the previous report on screen and flagged while a replacement generates", async () => {
        vi.mocked(portfoliosApi.regenerateFitGap).mockResolvedValue({ data: {} } as never);

        renderPage();
        await screen.findByText("Skill Comparison");

        fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

        const banner = await screen.findByText(/Regenerating\. The report below is the previous version/);
        expect(banner).toHaveAttribute("role", "status");
        expect(banner).toHaveAttribute("aria-live", "polite");
        expect(screen.getByText("Skill Comparison")).toBeInTheDocument();
        expect(portfoliosApi.regenerateFitGap).toHaveBeenCalledWith(7, 2);
    });

    it("renders the stored comparison, culture narrative and overall summary", async () => {
        renderPage();

        expect(await screen.findByText("Skill Comparison")).toBeInTheDocument();
        expect(screen.getByRole("table", { name: /Skill comparison/ })).toBeInTheDocument();
        expect(screen.getByText("React")).toBeInTheDocument();
        expect(screen.getByText("Culture fit narrative.")).toBeInTheDocument();
        expect(screen.getByText("Overall Summary")).toBeInTheDocument();
        expect(screen.getByText("Overall narrative.")).toBeInTheDocument();
        expect(screen.queryByText("No fit/gap report yet.")).not.toBeInTheDocument();
    });

    it("keeps the culture narrative slot explicit when the report has none", async () => {
        vi.mocked(portfoliosApi.getFitGap).mockResolvedValue({
            data: { report: { ...REPORT, culture_narrative: "", overall_narrative: "" } },
        } as never);

        renderPage();

        expect(await screen.findByText("Skill Comparison")).toBeInTheDocument();
        expect(
            screen.getByText(/No culture narrative was generated for this report\./)
        ).toBeInTheDocument();
        expect(screen.queryByText("Overall Summary")).not.toBeInTheDocument();
    });

    it("recovers from a load failure when the retry succeeds", async () => {
        vi.mocked(sessionsApi.getPortfolio)
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValue({ data: { portfolio: PORTFOLIO } } as never);

        renderPage();

        expect(await screen.findByRole("alert")).toHaveTextContent("We could not load this fit/gap report.");

        fireEvent.click(screen.getByRole("button", { name: /Retry/ }));

        expect(await screen.findByText("Skill Comparison")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
});
