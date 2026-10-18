import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AssessmentEditPage from "@/pages/assessments/AssessmentEditPage";
import { assessmentsApi } from "@/services/assessments";

vi.mock("@/services/assessments", () => ({
  assessmentsApi: { get: vi.fn(), update: vi.fn() },
}));

describe("AssessmentEditPage API null normalization", () => {
  it("normalizes nullable fields and allows an unrelated update to submit", async () => {
    vi.mocked(assessmentsApi.get).mockResolvedValue({
      data: {
        assessment: {
          id: 2,
          name: "Backend Engineer",
          time_limit_min: 45,
          skills: [{
            id: 9,
            skill_id: "skill-ruby",
            skill_label: "Ruby",
            is_custom: false,
            expected_level: 3,
            display_order: 0,
            scope_include: null,
            scope_exclude: null,
            l1_anchor: null,
            l2_anchor: null,
            l3_anchor: null,
            l4_anchor: null,
            l5_anchor: null,
          }],
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
    expect(screen.queryByText("Invalid input: expected string, received null")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(assessmentsApi.update).toHaveBeenCalled());
  });
});
