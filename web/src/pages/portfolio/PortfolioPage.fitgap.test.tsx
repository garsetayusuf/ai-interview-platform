import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PortfolioPage from "@/pages/portfolio/PortfolioPage";
import { sessionsApi } from "@/services/sessions";
import { vacanciesApi } from "@/services/vacancies";
import { portfoliosApi } from "@/services/portfolios";
import type { FitGapReport, Portfolio, Vacancy } from "@/types";

const navigateSpy = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
    const actual = await importOriginal<typeof import("react-router-dom")>();
    return { ...actual, useNavigate: () => navigateSpy };
});

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

const REPORT: FitGapReport = {
    id: 9,
    portfolio_id: 7,
    vacancy_id: 2,
    skill_comparisons: [],
    override_context: [],
    culture_narrative: "",
    overall_narrative: "",
    generated_at: "2026-10-18T11:00:00.000Z",
};

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

async function renderWith(vacancies: Vacancy[]) {
    vi.mocked(sessionsApi.getPortfolio).mockResolvedValue({ data: { portfolio: PORTFOLIO } } as never);
    vi.mocked(vacanciesApi.list).mockResolvedValue({ data: { vacancies } } as never);
    vi.mocked(sessionsApi.get).mockResolvedValue({
        data: { session: { id: 2, candidate_name: "Synthetic Candidate" } },
    } as never);
    vi.mocked(portfoliosApi.getFitGap).mockRejectedValue(new Error("404"));

    renderPage();
    await screen.findByRole("heading", { name: "Portfolio Results" });
}

function runButton() {
    return screen.getByRole("button", { name: /Generate Fit\/Gap Analysis/ });
}

function compareSelect() {
    return screen.getByRole("combobox", { name: /Compare against vacancy/ });
}

async function selectVacancy(title: string) {
    fireEvent.pointerDown(compareSelect(), { button: 0, ctrlKey: false, pointerType: "mouse" });
    const option = await screen.findByRole("option", { name: title });
    fireEvent.click(option);
}

describe("PortfolioPage run fit/gap control", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("blocks the comparison until a vacancy is chosen and says why", async () => {
        await renderWith(VACANCIES);

        expect(runButton()).toBeDisabled();
        expect(within(screen.getByTestId("portfolio-action-bar")).getByRole("status")).toHaveTextContent("Choose a vacancy to compare");

        await selectVacancy("Backend Engineer");

        await waitFor(() => expect(runButton()).toBeEnabled());
        expect(within(screen.getByTestId("portfolio-action-bar")).getByRole("status")).toHaveTextContent(
            "A comparison will be generated when you open the report."
        );
        expect(compareSelect()).toHaveAccessibleName("Compare against vacancy, 1 available");
    });

    it("offers a way out when there are no vacancies at all", async () => {
        await renderWith([]);

        expect(runButton()).toBeDisabled();
        expect(within(screen.getByTestId("portfolio-action-bar")).getByRole("status")).toHaveTextContent(
            "No vacancies yet. Create one to compare this portfolio."
        );
        expect(compareSelect()).toHaveAccessibleName("Compare against vacancy, 0 available");

        fireEvent.pointerDown(compareSelect(), { button: 0, ctrlKey: false, pointerType: "mouse" });

        expect(await screen.findByText("No vacancies yet.")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Create a vacancy" })).toBeInTheDocument();
    });

    it("navigates once to the comparison even when the button is pressed twice", async () => {
        await renderWith(VACANCIES);
        await selectVacancy("Backend Engineer");
        await waitFor(() => expect(runButton()).toBeEnabled());

        fireEvent.click(runButton());
        fireEvent.click(runButton());

        expect(navigateSpy).toHaveBeenCalledTimes(1);
        expect(navigateSpy).toHaveBeenCalledWith("/assessments/1/sessions/2/fitgap/2");
    });

    it("offers the existing report when one is already stored", async () => {
        await renderWith(VACANCIES);
        vi.mocked(portfoliosApi.getFitGap).mockResolvedValue({ data: { report: REPORT } } as never);

        await selectVacancy("Backend Engineer");

        const openExisting = await screen.findByRole("button", { name: "Open Fit/Gap Report" });
        expect(within(screen.getByTestId("portfolio-action-bar")).getByRole("status")).toHaveTextContent("Report available");

        fireEvent.click(openExisting);
        expect(navigateSpy).toHaveBeenCalledWith("/assessments/1/sessions/2/fitgap/2");
    });

    it("keeps the run action available while the portfolio is still generating", async () => {
        vi.mocked(sessionsApi.getPortfolio).mockResolvedValue({ data: { status: "generating" } } as never);
        vi.mocked(vacanciesApi.list).mockResolvedValue({ data: { vacancies: VACANCIES } } as never);
        vi.mocked(sessionsApi.get).mockResolvedValue({
            data: { session: { id: 2, candidate_name: "Synthetic Candidate" } },
        } as never);

        renderPage();
        await screen.findByRole("heading", { name: "Portfolio Results" });

        expect(within(screen.getByTestId("portfolio-action-bar")).getByRole("status")).toHaveTextContent(
            "The comparison can run once generation finishes."
        );

        const queued = screen.getByRole("button", { name: "Generating…" });
        expect(queued).toBeDisabled();
    });
});
