import { Button } from "@/components/ui/button";
import { PRIVACY_NOTICE } from "@/content/privacyNotice";
import { Loader2, ShieldCheck } from "lucide-react";
import type { ConsentState } from "@/types";

interface ConsentGateProps {
    roleTitle: string;
    timeLimitMin: number;
    consent: ConsentState;
    busy: boolean;
    errorMessage?: string | null;
    onAccept: () => void;
    onDecline: () => void;
}

export default function ConsentGate({
    roleTitle,
    timeLimitMin,
    consent,
    busy,
    errorMessage,
    onAccept,
    onDecline,
}: ConsentGateProps) {
    if (consent.declined) {
        return (
            <div className="max-w-xl mx-auto px-4 py-16 space-y-4 text-center">
                <h1 className="text-xl font-semibold">You cannot continue without consent.</h1>
                <p className="text-sm text-muted-foreground">
                    Your decision has been recorded and the interview has not started. Nothing was recorded.
                </p>
                <p className="text-sm text-muted-foreground">
                    To withdraw or delete your data, contact the hiring team with your invite link.
                </p>
            </div>
        );
    }

    return (
        <div className="max-w-xl mx-auto px-4 py-8 space-y-5">
            <div className="space-y-1">
                <h1 className="text-xl font-semibold">Before you start</h1>
                <p className="text-sm text-muted-foreground">
                    {roleTitle} · {timeLimitMin} minutes · voice interview
                </p>
            </div>

            <div className="flex items-start gap-2 text-sm bg-muted/50 border rounded-lg px-4 py-3">
                <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                <p className="text-muted-foreground">
                    Please read how your interview data is handled. You must agree before the interview can begin.
                </p>
            </div>

            <div className="max-h-[45vh] overflow-y-auto border rounded-lg p-4 space-y-4" tabIndex={0}>
                {PRIVACY_NOTICE.map((section) => (
                    <section key={section.heading} className="space-y-1.5">
                        <h2 className="text-sm font-semibold">{section.heading}</h2>
                        {section.paragraphs?.map((paragraph) => (
                            <p key={paragraph} className="text-sm text-muted-foreground">
                                {paragraph}
                            </p>
                        ))}
                        {section.bullets && (
                            <ul className="space-y-1">
                                {section.bullets.map((bullet) => (
                                    <li key={bullet} className="text-sm text-muted-foreground flex gap-2">
                                        <span aria-hidden="true">•</span>
                                        <span>{bullet}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                ))}
            </div>

            {errorMessage && (
                <p className="text-sm text-destructive" role="alert">
                    {errorMessage}
                </p>
            )}

            <div className="space-y-2">
                <Button className="w-full min-h-11" onClick={onAccept} disabled={busy}>
                    {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    I agree and continue
                </Button>
                <Button
                    variant="outline"
                    className="w-full min-h-11 text-destructive"
                    onClick={onDecline}
                    disabled={busy}
                >
                    I do not agree
                </Button>
            </div>
        </div>
    );
}
