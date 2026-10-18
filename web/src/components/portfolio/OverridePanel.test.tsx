import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import OverridePanel from "@/components/portfolio/OverridePanel";
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
    evidence: [],
    competency_summary: "",
};

const EXISTING_OVERRIDE: AssessorOverride = {
    id: 9,
    portfolio_skill_id: 41,
    ai_level: 3,
    override_level: 5,
    assessor_notes: "Already reviewed.",
};

const SAVED_OVERRIDE: AssessorOverride = {
    id: 9,
    portfolio_skill_id: 41,
    ai_level: 3,
    override_level: 5,
    assessor_notes: "Needs a deeper probe.",
};

function renderPanel(existingOverride?: AssessorOverride, onSaved = vi.fn()) {
    render(<OverridePanel skill={SKILL} existingOverride={existingOverride} onSaved={onSaved} />);
    return onSaved;
}

function openPanel() {
    fireEvent.click(screen.getByRole("button", { name: "Override rating ▼" }));
}

function ratingGroup() {
    return screen.getByRole("radiogroup", { name: "Your rating for React" });
}

describe("OverridePanel", () => {
    it("offers the override action when the skill has never been overridden", () => {
        renderPanel();

        expect(screen.getByRole("button", { name: "Override rating ▼" })).toBeEnabled();
        expect(screen.queryByRole("button", { name: "Edit override" })).not.toBeInTheDocument();
        expect(screen.queryByText("AI")).not.toBeInTheDocument();
    });

    it("shows the AI to override transition once an override exists", () => {
        renderPanel(EXISTING_OVERRIDE);

        expect(screen.queryByRole("button", { name: "Override rating ▼" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Edit override" })).toBeEnabled();
        expect(screen.getByText("AI")).toBeInTheDocument();
        expect(screen.getByText("→")).toBeInTheDocument();
        expect(screen.getByText(/You Overridden/)).toBeInTheDocument();
        expect(screen.getAllByText("L3")).toHaveLength(1);
        expect(screen.getAllByText("L5")).toHaveLength(1);
    });

    it("reveals the rating group and the notes field when opened", () => {
        renderPanel();

        openPanel();

        expect(ratingGroup()).toBeInTheDocument();
        expect(within(ratingGroup()).getAllByRole("radio")).toHaveLength(5);
        expect(screen.getByRole("textbox", { name: "Notes (optional):" })).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "L3" })).toBeChecked();
    });

    it("saves the chosen level and notes then hands the override back and collapses", async () => {
        const onSaved = vi.fn();
        vi.mocked(portfoliosApi.getOverride).mockResolvedValue({
            data: { override: SAVED_OVERRIDE },
        } as never);

        renderPanel(undefined, onSaved);
        openPanel();

        fireEvent.click(within(ratingGroup()).getByText("L5"));
        fireEvent.change(screen.getByRole("textbox", { name: "Notes (optional):" }), {
            target: { value: "Needs a deeper probe." },
        });
        fireEvent.click(screen.getByRole("button", { name: /Save override/ }));

        await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED_OVERRIDE));

        expect(portfoliosApi.getOverride).toHaveBeenCalledWith(41, {
            override_level: 5,
            assessor_notes: "Needs a deeper probe.",
        });
        expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Override rating ▼" })).toBeInTheDocument();
    });

    it("keeps the form open and reports the failure when saving is rejected", async () => {
        vi.mocked(portfoliosApi.getOverride).mockRejectedValue(new Error("boom"));

        renderPanel();
        openPanel();

        fireEvent.click(screen.getByRole("button", { name: /Save override/ }));

        expect(await screen.findByText("Failed to save override. Please try again.")).toBeInTheDocument();
        expect(ratingGroup()).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Save override/ })).toBeEnabled();
    });

    it("closes without touching the API when cancelled", () => {
        renderPanel();
        openPanel();

        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(portfoliosApi.getOverride).not.toHaveBeenCalled();
        expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Override rating ▼" })).toBeEnabled();
    });

    it("disables save while the request is in flight", async () => {
        let resolveSave!: (value: unknown) => void;
        const promise = new Promise<unknown>((resolve) => {
            resolveSave = resolve;
        });
        vi.mocked(portfoliosApi.getOverride).mockReturnValue(promise as never);

        renderPanel();
        openPanel();

        fireEvent.click(screen.getByRole("button", { name: /Save override/ }));

        await waitFor(() =>
            expect(screen.getByRole("button", { name: /Save override/ })).toBeDisabled()
        );

        await act(async () => {
            resolveSave({ data: { override: SAVED_OVERRIDE } });
        });

        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Override rating ▼" })).toBeInTheDocument()
        );
    });
});
