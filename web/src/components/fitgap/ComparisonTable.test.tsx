import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ComparisonTable from "@/components/fitgap/ComparisonTable";
import type { SkillComparison } from "@/types";

function comparison(overrides: Partial<SkillComparison> = {}): SkillComparison {
    return {
        skill_label: "React",
        required_level: 3,
        candidate_level: 3,
        result: "match",
        delta: 0,
        assessment_state: "assessed",
        is_override: false,
        candidate_level_source: "ai",
        ...overrides,
    };
}

function bodyRows() {
    return within(screen.getByRole("table")).getAllByRole("row").slice(1);
}

describe("ComparisonTable", () => {
    it("gives each comparison a row with both levels", () => {
        render(
            <ComparisonTable
                comparisons={[
                    comparison({
                        skill_label: "React",
                        required_level: 4,
                        candidate_level: 3,
                        result: "gap",
                        delta: -1,
                    }),
                    comparison({
                        skill_label: "SQL",
                        required_level: 2,
                        candidate_level: null,
                        result: "not_assessed",
                        delta: null,
                        assessment_state: "not_assessed",
                    }),
                ]}
            />
        );

        const rows = bodyRows();
        expect(rows).toHaveLength(2);

        expect(within(rows[0]).getByText("React")).toBeInTheDocument();
        expect(within(rows[0]).getByText("L4")).toBeInTheDocument();
        expect(within(rows[0]).getByText("L3")).toBeInTheDocument();

        expect(within(rows[1]).getByText("SQL")).toBeInTheDocument();
        expect(within(rows[1]).getByText("L2")).toBeInTheDocument();
        expect(within(rows[1]).getByText("—")).toBeInTheDocument();
    });

    it("labels each result and only appends the delta it actually has", () => {
        render(
            <ComparisonTable
                comparisons={[
                    comparison({ skill_label: "Match row", result: "match", delta: 0 }),
                    comparison({ skill_label: "Exceed row", result: "exceed", delta: 2 }),
                    comparison({ skill_label: "Exceed without delta", result: "exceed", delta: null }),
                    comparison({ skill_label: "Gap row", result: "gap", delta: -2 }),
                    comparison({
                        skill_label: "Untested row",
                        result: "not_assessed",
                        delta: null,
                        assessment_state: "not_assessed",
                    }),
                ]}
            />
        );

        const rows = bodyRows();

        expect(within(rows[0]).getByText("✅ Match")).toBeInTheDocument();
        expect(within(rows[0]).queryByText(/Match [+-]/)).not.toBeInTheDocument();

        expect(within(rows[1]).getByText("⭐ Exceeds +2")).toBeInTheDocument();

        expect(within(rows[2]).getByText("⭐ Exceeds")).toBeInTheDocument();
        expect(within(rows[2]).queryByText(/Exceeds [+-]/)).not.toBeInTheDocument();

        expect(within(rows[3]).getByText("⚠ Gap -2")).toBeInTheDocument();

        expect(within(rows[4]).getByText("— Not assessed")).toBeInTheDocument();
        expect(within(rows[4]).queryByText(/Not assessed [+-]/)).not.toBeInTheDocument();
    });

    it("marks only the rows whose candidate level came from a human override", () => {
        render(
            <ComparisonTable
                comparisons={[
                    comparison({
                        skill_label: "Overridden",
                        candidate_level: 4,
                        is_override: true,
                        candidate_level_source: "assessor_override",
                    }),
                    comparison({ skill_label: "AI rated", candidate_level: 3 }),
                    comparison({
                        skill_label: "Overridden but unlevelled",
                        candidate_level: null,
                        result: "not_assessed",
                        delta: null,
                        is_override: true,
                        assessment_state: "not_assessed",
                        candidate_level_source: "assessor_override",
                    }),
                ]}
            />
        );

        const rows = bodyRows();

        expect(within(rows[0]).getByText("✏")).toBeInTheDocument();
        expect(within(rows[0]).getByTitle("Human override applied")).toBeInTheDocument();
        expect(within(rows[1]).queryByText("✏")).not.toBeInTheDocument();
        expect(within(rows[2]).queryByText("✏")).not.toBeInTheDocument();
        expect(screen.getAllByText("✏")).toHaveLength(1);
    });

    it("renders the evidence state of every row in words", () => {
        render(
            <ComparisonTable
                comparisons={[
                    comparison({ skill_label: "Assessed row" }),
                    comparison({
                        skill_label: "Thin evidence row",
                        assessment_state: "insufficient_evidence",
                    }),
                    comparison({
                        skill_label: "Never assessed row",
                        candidate_level: null,
                        delta: null,
                        assessment_state: "not_assessed",
                    }),
                ]}
            />
        );

        const rows = bodyRows();

        expect(within(rows[0]).getAllByText("Assessed")).toHaveLength(1);
        expect(within(rows[0]).queryByText("Insufficient evidence")).not.toBeInTheDocument();
        expect(within(rows[1]).getAllByText("Insufficient evidence")).toHaveLength(2);
        expect(within(rows[2]).getAllByText("Not assessed")).toHaveLength(2);
    });

    it("announces a summary of the comparison set and pluralises each count", () => {
        render(
            <ComparisonTable
                comparisons={[
                    comparison({ skill_label: "React", result: "match", delta: 0 }),
                    comparison({ skill_label: "Ruby", result: "match", delta: 0 }),
                    comparison({ skill_label: "SQL", result: "gap", delta: -1 }),
                    comparison({ skill_label: "Docker", result: "exceed", delta: 1 }),
                    comparison({
                        skill_label: "Kafka",
                        candidate_level: null,
                        result: "not_assessed",
                        delta: null,
                        assessment_state: "insufficient_evidence",
                    }),
                    comparison({
                        skill_label: "Terraform",
                        candidate_level: 4,
                        result: "not_assessed",
                        delta: null,
                        assessment_state: "not_assessed",
                        is_override: true,
                        candidate_level_source: "assessor_override",
                    }),
                ]}
            />
        );

        const status = screen.getByRole("status");
        expect(status).toHaveAttribute("aria-live", "polite");

        expect(within(status).getByText("Match: 2 skills")).toBeInTheDocument();
        expect(within(status).getByText("Gap: 1 skill")).toBeInTheDocument();
        expect(within(status).getByText("Exceeds: 1 skill")).toBeInTheDocument();
        expect(within(status).getByText("Insufficient evidence: 1 skill")).toBeInTheDocument();
        expect(within(status).getByText("Not assessed: 1 skill")).toBeInTheDocument();
        expect(within(status).getByText("Human override applied: 1 skill")).toBeInTheDocument();
    });

    it("shows the headers and no comparison rows when there is nothing to compare", () => {
        render(<ComparisonTable comparisons={[]} />);

        const table = screen.getByRole("table");
        const rows = within(table).getAllByRole("row");

        expect(rows).toHaveLength(1);
        expect(within(rows[0]).getByRole("columnheader", { name: "Skill" })).toBeInTheDocument();
        expect(within(rows[0]).getByRole("columnheader", { name: "Required" })).toBeInTheDocument();
        expect(within(rows[0]).getByRole("columnheader", { name: "Candidate" })).toBeInTheDocument();
        expect(within(rows[0]).getByRole("columnheader", { name: "Result" })).toBeInTheDocument();
        expect(
            within(rows[0]).getByRole("columnheader", { name: "Evidence state" })
        ).toBeInTheDocument();

        const status = screen.getByRole("status");
        expect(within(status).queryByText(/Match:/)).not.toBeInTheDocument();
        expect(within(status).queryByText(/Human override applied/)).not.toBeInTheDocument();
    });

    it("captions the table and keeps it inside a scroll wrapper", () => {
        const { container } = render(<ComparisonTable comparisons={[comparison()]} />);

        const table = screen.getByRole("table");
        expect(table).toHaveAccessibleName(
            "Skill comparison: vacancy requirement, candidate level, and fit result"
        );

        const wrapper = table.parentElement;
        expect(wrapper).not.toBeNull();
        expect(wrapper).not.toBe(container.firstElementChild);
        expect(container.firstElementChild?.contains(table)).toBe(true);
    });
});
