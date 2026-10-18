import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LiveMonitorPage from "@/pages/monitor/LiveMonitorPage";
import { sessionsApi } from "@/services/sessions";
import { useCoverageWebSocket } from "@/hooks/useCoverageWebSocket";

vi.mock("@/services/sessions", () => ({
    sessionsApi: {
        get: vi.fn(),
        getTranscript: vi.fn(),
        endSession: vi.fn(),
    },
}));

vi.mock("@/hooks/useCoverageWebSocket", () => ({
    useCoverageWebSocket: vi.fn(),
}));

function renderPage() {
    return render(
        <MemoryRouter initialEntries={["/assessments/2/sessions/2/monitor"]}>
            <Routes>
                <Route
                    path="/assessments/:id/sessions/:sessionId/monitor"
                    element={<LiveMonitorPage />}
                />
            </Routes>
        </MemoryRouter>
    );
}

const TURNS = [
    { id: 1, turn_number: 1, speaker: "ai", text: "Tell me about your last project." },
    { id: 2, turn_number: 2, speaker: "candidate", text: "I built an ingestion pipeline." },
];

describe("LiveMonitorPage failure handling", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useCoverageWebSocket).mockReturnValue({
            coverageMap: { skills: [], discovered: [] },
            sessionEnded: false,
            sessionEndReason: null,
            isConnected: true,
        } as never);
    });

    it("reports a load failure and recovers on retry", async () => {
        vi.mocked(sessionsApi.get).mockRejectedValueOnce(new Error("offline"));
        vi.mocked(sessionsApi.getTranscript).mockRejectedValueOnce(new Error("offline"));
        renderPage();

        expect(await screen.findByRole("alert")).toHaveTextContent("We could not load this session.");

        vi.mocked(sessionsApi.get).mockResolvedValue({
            data: { session: { id: 2, status: "active", assessment: { name: "Backend Screen" } } },
        } as never);
        vi.mocked(sessionsApi.getTranscript).mockResolvedValue({ data: { turns: TURNS } } as never);

        fireEvent.click(screen.getByRole("button", { name: /Retry/ }));

        expect(await screen.findByText("Backend Screen")).toBeInTheDocument();
    });

    it("announces a stalled transcript poll without dropping the turns it already has", async () => {
        vi.useFakeTimers();
        vi.mocked(sessionsApi.get).mockResolvedValue({
            data: { session: { id: 2, status: "active", assessment: { name: "Backend Screen" } } },
        } as never);
        vi.mocked(sessionsApi.getTranscript)
            .mockResolvedValueOnce({ data: { turns: TURNS } } as never)
            .mockRejectedValue(new Error("offline"));

        renderPage();
        await act(async () => {});

        expect(screen.getByRole("log")).toHaveTextContent("I built an ingestion pipeline.");
        expect(screen.queryByText(/Transcript updates are paused/)).not.toBeInTheDocument();

        await act(async () => {
            vi.advanceTimersByTime(3100);
        });
        await act(async () => {});

        expect(screen.getByText(/Transcript updates are paused/)).toBeInTheDocument();
        expect(screen.getByRole("log")).toHaveTextContent("I built an ingestion pipeline.");

        vi.useRealTimers();
    });

    it("announces the end-session failure", async () => {
        vi.mocked(sessionsApi.get).mockResolvedValue({
            data: { session: { id: 2, status: "active", assessment: { name: "Backend Screen" } } },
        } as never);
        vi.mocked(sessionsApi.getTranscript).mockResolvedValue({ data: { turns: TURNS } } as never);
        vi.mocked(sessionsApi.endSession).mockRejectedValue(new Error("offline"));

        renderPage();
        await waitFor(() => expect(screen.getByRole("log")).toBeInTheDocument());

        fireEvent.click(screen.getByRole("button", { name: "End Session" }));
        fireEvent.click(await screen.findByRole("button", { name: "End Session" }));

        await waitFor(() =>
            expect(screen.getByRole("alert")).toHaveTextContent("Failed to end session")
        );
    });
});
