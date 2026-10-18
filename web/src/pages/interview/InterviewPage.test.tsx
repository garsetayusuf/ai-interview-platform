import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import InterviewPage from "@/pages/interview/InterviewPage";
import { sessionsApi } from "@/services/sessions";
import type { CandidateInfo, ConsentState } from "@/types";

vi.mock("@/services/sessions", () => ({
    sessionsApi: {
        getCandidateInfo: vi.fn(),
        acceptConsent: vi.fn(),
        declineConsent: vi.fn(),
        audioComplete: vi.fn(),
    },
}));

vi.mock("@/hooks/useAudioWebSocket", () => ({
    useAudioWebSocket: () => ({
        connect: vi.fn(),
        send: vi.fn(),
        sendJson: vi.fn(),
        disconnect: vi.fn(),
        connectionState: "disconnected",
    }),
}));

vi.mock("@/hooks/useAudioCapture", () => ({
    useAudioCapture: () => ({ start: vi.fn(), stop: vi.fn(), mute: vi.fn(), unmute: vi.fn() }),
}));

vi.mock("@/hooks/useAudioPlayback", () => ({
    useAudioPlayback: () => ({
        playChunk: vi.fn(),
        stop: vi.fn(),
        scheduleAfterPlayback: vi.fn(),
        waitForDrain: vi.fn(),
        cancelDrain: vi.fn(),
    }),
}));

const PENDING: ConsentState = { required: true, accepted: false, declined: false, version: "v1" };

function candidateInfo(overrides: Partial<CandidateInfo> = {}): CandidateInfo {
    return {
        session_id: 2,
        role_title: "Backend Engineer",
        time_limit_min: 45,
        session_status: "pending",
        consent: PENDING,
        ...overrides,
    };
}

function renderPage() {
    return render(
        <MemoryRouter initialEntries={["/interview/tok-123"]}>
            <Routes>
                <Route path="/interview/:token" element={<InterviewPage />} />
            </Routes>
        </MemoryRouter>
    );
}

describe("InterviewPage consent gate", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(sessionsApi.getCandidateInfo).mockResolvedValue({ data: candidateInfo() } as never);
    });

    it("shows the notice before any hardware check", async () => {
        renderPage();

        expect(await screen.findByRole("heading", { name: "Before you start" })).toBeInTheDocument();
        expect(screen.queryByText("OS & browser")).not.toBeInTheDocument();
        expect(screen.queryByText(/This is a voice interview/)).not.toBeInTheDocument();
    });

    it("opens the interview only after the decision is recorded", async () => {
        vi.mocked(sessionsApi.acceptConsent).mockResolvedValue({
            data: { consent: { ...PENDING, accepted: true } },
        } as never);

        renderPage();

        fireEvent.click(await screen.findByRole("button", { name: "I agree and continue" }));

        await waitFor(() => expect(sessionsApi.acceptConsent).toHaveBeenCalledWith("tok-123", "v1"));
        expect(await screen.findByText("OS & browser")).toBeInTheDocument();
    });

    it("stays gated and says so when the decision cannot be recorded", async () => {
        vi.mocked(sessionsApi.acceptConsent).mockRejectedValue(new Error("offline"));

        renderPage();

        fireEvent.click(await screen.findByRole("button", { name: "I agree and continue" }));

        expect(await screen.findByRole("alert")).toHaveTextContent("We could not record your consent");
        expect(screen.queryByText("OS & browser")).not.toBeInTheDocument();
    });

    it("blocks a candidate who declines", async () => {
        vi.mocked(sessionsApi.declineConsent).mockResolvedValue({
            data: { consent: { ...PENDING, declined: true } },
        } as never);

        renderPage();

        fireEvent.click(await screen.findByRole("button", { name: "I do not agree" }));

        await waitFor(() => expect(sessionsApi.declineConsent).toHaveBeenCalledWith("tok-123", "v1"));
        expect(
            await screen.findByRole("heading", { name: "You cannot continue without consent." })
        ).toBeInTheDocument();
        expect(screen.queryByText("OS & browser")).not.toBeInTheDocument();
    });

    it("keeps a previously declined candidate blocked on reload", async () => {
        vi.mocked(sessionsApi.getCandidateInfo).mockResolvedValue({
            data: candidateInfo({ consent: { ...PENDING, declined: true } }),
        } as never);

        renderPage();

        expect(
            await screen.findByRole("heading", { name: "You cannot continue without consent." })
        ).toBeInTheDocument();
    });

    it("does not gate an already recorded acceptance", async () => {
        vi.mocked(sessionsApi.getCandidateInfo).mockResolvedValue({
            data: candidateInfo({ consent: { ...PENDING, accepted: true } }),
        } as never);

        renderPage();

        expect(await screen.findByText("OS & browser")).toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "Before you start" })).not.toBeInTheDocument();
    });
});
