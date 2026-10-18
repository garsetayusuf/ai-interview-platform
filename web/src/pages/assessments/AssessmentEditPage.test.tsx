import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AssessmentEditPage from "@/pages/assessments/AssessmentEditPage";
import { assessmentsApi } from "@/services/assessments";

vi.mock("@/services/assessments", () => ({
  assessmentsApi: { get: vi.fn(), update: vi.fn() },
}));

function legacySkill(id: number, label: string) {
  return {
    id,
    skill_id: null,
    skill_label: label,
    is_custom: false,
    expected_level: null,
    display_order: id,
    scope_include: null,
    scope_exclude: null,
    l1_anchor: null,
    l2_anchor: null,
    l3_anchor: null,
    l4_anchor: null,
    l5_anchor: null,
  };
}

describe("AssessmentEditPage legacy-null regression", () => {
  it("loads every nullable skill field and saves after removing one skill", async () => {
    vi.mocked(assessmentsApi.get).mockResolvedValue({
      data: {
        assessment: {
          id: 2,
          name: "Backend Engineer",
          time_limit_min: 45,
          skills: [legacySkill(9, "Ruby"), legacySkill(10, "Rails")],
        },
      },
    } as never);
    vi.mocked(assessmentsApi.update).mockResolvedValue({ data: { assessment: {} } } as never);

    render(
      <MemoryRouter initialEntries={["/assessments/2/edit"]}>
        <Routes>
          <Route path="/assessments/:id/edit" element={<AssessmentEditPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Edit Assessment")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove skill" })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove skill" })[0]);
    const form = screen.getByRole("button", { name: "Save Changes" }).closest("form");
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    await waitFor(() => expect(assessmentsApi.update).toHaveBeenCalled());

    const payload = vi.mocked(assessmentsApi.update).mock.calls[0][1] as {
      assessment_skills_attributes: Array<{ id?: number }>;
    };
    expect(payload.assessment_skills_attributes).toHaveLength(1);
    expect(payload.assessment_skills_attributes[0].id).toBe(10);
  });
});
