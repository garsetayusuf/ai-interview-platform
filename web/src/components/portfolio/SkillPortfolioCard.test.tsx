import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import SkillPortfolioCard from "@/components/portfolio/SkillPortfolioCard";
import { portfoliosApi } from "@/services/portfolios";
import type { AssessorOverride, PortfolioSkill } from "@/types";

vi.mock("@/services/portfolios", () => ({
    portfoliosApi: { getOverride: vi.fn() },
}));

const SKILL: PortfolioSkill = {
    id: 41,
    skill_label: "React",
    is_discovered: false,
    ai_level: 3,
    ai_confidence: "high",
    assessment_state: "assessed",
    evidence: ["Shipped a component library.", "Mentored two juniors."],
    competency_summary: "Comfortable owning a feature end to end.",
};

const OVERRIDE: AssessorOverride = {
    id: 9,
    portfolio_skill_id: 41,
    ai_level: 3,
    override_level: 5,
    assessor_notes: "Reviewed with the hiring manager.",
};

function CardHarness({
    skill,
    onOverrideSaved,
}: {
    skill: PortfolioSkill;
    onOverrideSaved: (override: AssessorOverride) => void;
}) {
    const [override, setOverride] = useState<AssessorOverride | undefined>(undefined);

    return (
        <SkillPortfolioCard
            skill={skill}
            override={override}
            onOverrideSaved={(saved) => {
                setOverride(saved);
                onOverrideSaved(saved);
            }}
        />
    );
}

describe("SkillPortfolioCard", () => {
    it("shows the AI level when the skill has no override", () => {
        render(<SkillPortfolioCard skill={SKILL} onOverrideSaved={vi.fn()} />);

        expect(screen.getByText("L3")).toBeInTheDocument();
        expect(screen.getByText("Proficient")).toBeInTheDocument();
        expect(screen.queryByText("Expert")).not.toBeInTheDocument();
        expect(screen.queryByText("AI")).not.toBeInTheDocument();
        expect(screen.queryByText("→")).not.toBeInTheDocument();
    });

    it("shows the override level with the AI to override marker", () => {
        render(<SkillPortfolioCard skill={SKILL} override={OVERRIDE} onOverrideSaved={vi.fn()} />);

        expect(screen.getByText("Expert")).toBeInTheDocument();
        expect(screen.queryByText("Proficient")).not.toBeInTheDocument();
        expect(screen.getByText("AI")).toBeInTheDocument();
        expect(screen.getByText("→")).toBeInTheDocument();
        expect(screen.getAllByText("L5")).toHaveLength(2);
        expect(screen.getAllByText("L3")).toHaveLength(1);
    });

    it("renders every evidence quote taken from the interview", () => {
        render(<SkillPortfolioCard skill={SKILL} onOverrideSaved={vi.fn()} />);

        expect(screen.getByText(/Shipped a component library\./)).toBeInTheDocument();
        expect(screen.getByText(/Mentored two juniors\./)).toBeInTheDocument();
        expect(screen.getByText("Evidence from interview")).toBeInTheDocument();
    });

    it("renders the competency summary", () => {
        render(<SkillPortfolioCard skill={SKILL} onOverrideSaved={vi.fn()} />);

        expect(screen.getByText("Competency summary")).toBeInTheDocument();
        expect(screen.getByText("Comfortable owning a feature end to end.")).toBeInTheDocument();
    });

    it("marks a skill the interview surfaced but the posting never asked for", () => {
        const { unmount } = render(
            <SkillPortfolioCard skill={{ ...SKILL, is_discovered: true }} onOverrideSaved={vi.fn()} />
        );

        expect(screen.getByText("Discovered")).toBeInTheDocument();

        unmount();
        render(<SkillPortfolioCard skill={SKILL} onOverrideSaved={vi.fn()} />);

        expect(screen.queryByText("Discovered")).not.toBeInTheDocument();
    });

    it("switches to the new level after an override is saved through its own panel", async () => {
        vi.mocked(portfoliosApi.getOverride).mockResolvedValue({
            data: { override: OVERRIDE },
        } as never);
        const onOverrideSaved = vi.fn();

        render(<CardHarness skill={SKILL} onOverrideSaved={onOverrideSaved} />);

        expect(screen.getByText("Proficient")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Override rating ▼" }));
        const group = screen.getByRole("radiogroup", { name: "Your rating for React" });
        fireEvent.click(within(group).getByText("L5"));
        fireEvent.click(screen.getByRole("button", { name: /Save override/ }));

        await waitFor(() => expect(onOverrideSaved).toHaveBeenCalledWith(OVERRIDE));

        expect(screen.getByText("Expert")).toBeInTheDocument();
        expect(screen.queryByText("Proficient")).not.toBeInTheDocument();
        expect(screen.getByText("AI")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Edit override" })).toBeInTheDocument();
    });
});
