"use client";

import { useState } from "react";
import { RefreshCw, Check, AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

type ReindexState = "idle" | "success" | "error";

interface ReindexButtonProps {
  packageName: string;
}

export function ReindexButton({ packageName }: ReindexButtonProps) {
  const router = useRouter();
  const [state, setState] = useState<ReindexState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleReindex = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setState("idle");
    setMessage(null);

    try {
      const response = await fetch("/api/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageName }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `Failed with status ${response.status}`);
      }

      setState("success");
      setMessage("Package reindexed successfully.");
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Reindex failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const icon =
    state === "success" ? <Check className="h-3.5 w-3.5" /> : state === "error" ? (
      <AlertCircle className="h-3.5 w-3.5" />
    ) : (
      <RefreshCw className="h-3.5 w-3.5" />
    );

  return (
    <div className="space-y-2">
      <Button
        onClick={handleReindex}
        disabled={isSubmitting}
        variant={state === "success" ? "secondary" : "outline"}
        className="flex items-center gap-2"
      >
        {icon}
        {isSubmitting ? "Reindexing…" : "Reindex package"}
      </Button>
      {message && (
        <p
          className={`text-xs ${
            state === "error" ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
