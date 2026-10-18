import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PortfolioPage from "@/pages/portfolio/PortfolioPage";
import { sessionsApi } from "@/services/sessions";
import { vacanciesApi } from "@/services/vacancies";
import { portfoliosApi } from "@/services/portfolios";
import type { Portfolio, Vacancy } from "@/types";

vi.mock("@/services/sessions", () => ({
    sessionsApi: {
        getPortfolio: vi.fn(),
        get: vi.fn(),
        regeneratePortfolio: vi.fn(),
    },
}));

vi.mock("@/services/vacancies", () => ({
    vacanciesApi: { list: vi.fn() },
}));

vi.mock("@/services/portfolios", () => ({
    portfoliosApi: {
        getFitGap: vi.fn(),
        exportPortfolio: vi.fn(),
        getOverride: vi.fn(),
        triggerFitGap: vi.fn(),
        regenerateFitGap: vi.fn(),
    },
}));

const PORTFOLIO: Portfolio = {
    id: 7,
    session_id: 2,
    generation_status: "complete",
    generated_at: "2026-10-18T10:00:00.000Z",
    skills: [
        {
            id: 41,
            skill_label: "React",
            is_discovered: false,
            ai_level: 3,
            ai_confidence: "high",
            assessment_state: "assessed",
            evidence: ["Synthetic candidate evidence."],
            competency_summary: "Synthetic summary.",
        },
    ],
    overrides: [],
};

const VACANCIES: Vacancy[] = [
    { id: 2, role_title: "Backend Engineer", culture_dimensions: "", competency_expectations: "", skills: [] },
];

function renderPage() {
    return render(
        <MemoryRouter initialEntries={["/assessments/1/sessions/2/portfolio"]}>
            <Routes>
                <Route
                    path="/assessments/:id/sessions/:sessionId/portfolio"
                    element={<PortfolioPage />}
                />
            </Routes>
        </MemoryRouter>
    );
}

async function pageWithPortfolio() {
    vi.mocked(sessionsApi.getPortfolio).mockResolvedValue({ data: { portfolio: PORTFOLIO } } as never);
    vi.mocked(vacanciesApi.list).mockResolvedValue({ data: { vacancies: VACANCIES } } as never);
    vi.mocked(sessionsApi.get).mockResolvedValue({
        data: { session: { id: 2, candidate_name: "Synthetic Candidate" } },
    } as never);
    vi.mocked(portfoliosApi.getFitGap).mockRejectedValue(new Error("404"));

    renderPage();
    await screen.findByRole("heading", { name: "Portfolio Results" });
}

describe("PortfolioPage action bar", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("keeps every portfolio action in one bar above the results", async () => {
        await pageWithPortfolio();

        const bar = screen.getByTestId("portfolio-action-bar");

        expect(within(bar).getByRole("heading", { name: "Portfolio Results" })).toBeInTheDocument();
        expect(within(bar).getByText("Synthetic Candidate")).toBeInTheDocument();
        expect(within(bar).getByRole("link", { name: "Transcript" })).toBeInTheDocument();
        expect(within(bar).getByRole("button", { name: "PDF" })).toBeInTheDocument();
        expect(within(bar).getByRole("button", { name: "JSON" })).toBeInTheDocument();
        expect(within(bar).getByRole("button", { name: /Run Fit\/Gap Analysis/ })).toBeInTheDocument();

        // The actions exist once: they were moved, not duplicated.
        expect(screen.getAllByRole("link", { name: "Transcript" })).toHaveLength(1);
        expect(screen.getAllByRole("button", { name: /Run Fit\/Gap Analysis/ })).toHaveLength(1);
    });

    it("reaches the same actions from the mobile actions sheet", async () => {
        await pageWithPortfolio();

        const bar = screen.getByTestId("portfolio-action-bar");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        fireEvent.click(within(bar).getByRole("button", { name: "Actions" }));

        const sheet = screen.getByRole("dialog");
        expect(sheet).toHaveAccessibleName("Portfolio actions");
        expect(within(sheet).getByRole("link", { name: "Transcript" })).toBeInTheDocument();
        expect(within(sheet).getByRole("button", { name: "PDF" })).toBeInTheDocument();
        expect(within(sheet).getByRole("button", { name: "JSON" })).toBeInTheDocument();
        expect(within(sheet).getByRole("button", { name: /Run Fit\/Gap Analysis/ })).toBeInTheDocument();
    });

    it("labels the back affordance and the compare-against control", async () => {
        await pageWithPortfolio();

        const bar = screen.getByTestId("portfolio-action-bar");

        expect(within(bar).getByRole("link", { name: "Back to invitations" })).toBeInTheDocument();
        expect(
            within(bar).getByRole("combobox", { name: "Compare against vacancy, 1 available" })
        ).toBeInTheDocument();
    });
});
