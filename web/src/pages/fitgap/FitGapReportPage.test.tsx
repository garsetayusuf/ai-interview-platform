import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

    it("reports a load failure with retry", async () => {
        vi.mocked(sessionsApi.getPortfolio).mockRejectedValue(new Error("offline"));
        renderPage();

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "We could not load this fit/gap report."
        );
        expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
    });
});
