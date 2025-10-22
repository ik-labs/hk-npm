"use client";

import { useCallback, useRef, useState } from "react";
import { Copy, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const DEFAULT_INTENTS = [
  "Show me basic initialisation",
  "Generate an example with retries",
  "Create an API call with proper auth headers",
];

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export type PackageChatProps = {
  packageName: string;
  version: string;
  description?: string;
  presets?: string[];
};

export type AnswerSuccess = {
  intent: string;
  packageName: string;
  searchQuery: string;
  code: string;
  context: Array<{
    name: string;
    kind: string;
    file_path: string;
    jsdoc?: string;
    signature?: string;
    is_exported: boolean;
  }>;
  grounded: boolean;
  note?: string;
};

export type ChatTurn =
  | { id: string; role: "user"; content: string }
  | {
      id: string;
      role: "assistant";
      content: string;
      loading?: boolean;
      error?: string;
      answer?: AnswerSuccess;
    };

export function PackageChat({
  packageName,
  version,
  description,
  presets = [],
}: PackageChatProps) {
  const suggestions = presets.length ? presets : DEFAULT_INTENTS;
  const [query, setQuery] = useState(suggestions[0] ?? "");
  const [turns, setTurns] = useState<ChatTurn[]>([
    {
      id: "intro",
      role: "assistant",
      content:
          description
            ? `${description}\n\nAsk for examples or explanations and I'll generate grounded TypeScript from ${packageName}@${version}.`
            : `You're chatting with grounded docs for ${packageName}@${version}. Ask for examples or explanations and I'll generate grounded TypeScript using real source code.`,
    },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }, []);

  const addTurn = useCallback((turn: ChatTurn) => {
    setTurns((prev) => [...prev, turn]);
    scrollToBottom();
  }, [scrollToBottom]);

  const updateTurn = useCallback((id: string, updates: Partial<ChatTurn>) => {
    setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, ...updates } : turn)));
    scrollToBottom();
  }, [scrollToBottom]);

  const handleSubmit = useCallback(
    async (event?: React.FormEvent<HTMLFormElement>) => {
      if (event) event.preventDefault();
      const intent = query.trim();
      if (!intent || submitting) return;

      setSubmitting(true);
      setQuery(""); // clear input immediately

      const userId = makeId();
      addTurn({ id: userId, role: "user", content: intent });

      const assistantId = makeId();
      addTurn({
        id: assistantId,
        role: "assistant",
        content: `Generating grounded TypeScript using ${packageName}@${version}…`,
        loading: true,
      });

      const queryAnswer = async (searchQuery: string) => {
        const res = await fetch("/api/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            packageName,
            intent,
            searchQuery,
            maxSnippets: 6,
          }),
        });

        const data: AnswerSuccess | { error: string } = await res.json();
        if (!res.ok || "error" in data) {
          throw new Error(
            data && "error" in data ? data.error : `Answer failed with status ${res.status}`,
          );
        }
        return data as AnswerSuccess;
      };

      try {
        const data = await queryAnswer(intent);

        updateTurn(assistantId, {
          loading: false,
          content: data.grounded
            ? "Here’s grounded TypeScript using only real APIs."
            : data.note ?? "Generated without grounded context. Review before using in production.",
          answer: data,
        });
      } catch (error) {
        console.error(error);
        updateTurn(assistantId, {
          loading: false,
          content: "I couldn’t generate grounded code right now.",
          error: error instanceof Error ? error.message : "Unknown error occurred.",
        });
      } finally {
        setSubmitting(false);
        if (textareaRef.current) textareaRef.current.focus();
      }
    },
    [addTurn, packageName, query, submitting, updateTurn, version],
  );

  const handleCopy = useCallback(async (answer: AnswerSuccess, id: string) => {
    try {
      await navigator.clipboard.writeText(answer.code);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch (error) {
      console.error(error);
      setCopiedId(null);
    }
  }, []);

  return (
    <div className="flex h-full flex-col rounded-3xl border border-border/40 bg-gradient-to-br from-card/90 to-card/70 shadow-xl backdrop-blur-sm">
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-6 scroll-smooth">
        {turns.map((turn) => (
          <div
            key={turn.id}
            className={cn("flex w-full", turn.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
            className={cn(
            "max-w-2xl rounded-2xl px-5 py-4 text-sm shadow-lg transition-all duration-200 hover:shadow-xl",
            turn.role === "user"
            ? "bg-secondary text-secondary-foreground shadow-secondary/20"
            : "border border-border/50 bg-gradient-to-br from-background to-muted/20 text-foreground shadow-border/10",
            )}
            >
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
                <span>{turn.role === "user" ? "You" : packageName}</span>
                {turn.role === "assistant" && turn.loading && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
              </div>
              <p className="mt-3 whitespace-pre-wrap leading-relaxed text-sm">
              {turn.content}
              </p>
              {turn.role === "assistant" && turn.error && (
              <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-destructive flex items-center gap-2">
                  <span>⚠️</span>
                    {turn.error}
                  </p>
                </div>
              )}
              {turn.role === "assistant" && turn.answer && (
              <div className="mt-4 space-y-4">
              {!turn.answer.grounded && (
                <div className="flex items-center gap-2 text-xs text-amber-500">
                  <Sparkles className="h-4 w-4" />
                  <span>{turn.answer.note ?? "Best-effort answer generated without grounded context."}</span>
                </div>
              )}
              <div className="overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-muted/10 shadow-lg">
              <div className="flex items-center justify-between border-b border-border/60 bg-gradient-to-r from-muted/60 to-muted/30 px-5 py-4">
                      <p className="text-xs font-semibold text-muted-foreground">
                        Intent: {turn.answer.intent}
                      </p>
                      <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs hover:bg-white/10 transition-colors"
                      onClick={() => handleCopy(turn.answer!, turn.id)}
                      >
                        <Copy className="mr-2 h-3.5 w-3.5" />
                        {copiedId === turn.id ? "Copied" : "Copy"}
                      </Button>
                    </div>
                    <div className="space-y-4 px-5 py-5">
                    <div className="relative">
                    <pre className="max-h-[400px] overflow-y-auto overflow-x-hidden rounded-xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-5 text-[13px] leading-relaxed text-slate-50 shadow-inner border border-slate-700/50">
                        <code className="whitespace-pre-wrap break-words font-mono">{turn.answer.code}</code>
                        </pre>
                        <div className="absolute top-3 right-3 flex gap-1">
                          <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                          <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                          <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                        </div>
                      </div>
                      {turn.answer.context.length > 0 && (
                      <div className="rounded-xl border border-border/40 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 dark:from-blue-950/20 dark:to-indigo-950/20 p-4 shadow-sm">
                      <p className="text-xs font-semibold text-foreground/80 mb-3 flex items-center gap-2">
                      <span>📚</span>
                        Context references
                      </p>
                      <ul className="space-y-2 text-xs">
                      {turn.answer.context.map((ctx) => (
                      <li key={`${ctx.file_path}-${ctx.name}`} className="flex items-center gap-2 p-2 rounded-lg bg-white/60 dark:bg-slate-800/40 border border-border/30">
                      <span className="text-sm">{ctx.is_exported ? "📤" : "🔒"}</span>
                      <span className="font-medium text-foreground/90">{ctx.name}</span>
                      <span className="font-mono text-[11px] text-muted-foreground/70 ml-auto">
                        {ctx.file_path}
                        </span>
                        </li>
                        ))}
                        </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
<form onSubmit={handleSubmit} className="flex flex-col gap-3 border-t border-border/40 bg-card px-6 py-6">
        <Textarea
          ref={textareaRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Ask about ${packageName}…`}
          rows={3}
          className="resize-none"
        />
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>Try:</span>
            {suggestions.map((preset) => (
              <Badge
                key={preset}
                variant="outline"
                className="cursor-pointer"
                onClick={() => {
                  setQuery(preset);
                  if (textareaRef.current) textareaRef.current.focus();
                }}
              >
                {preset}
              </Badge>
            ))}
          </div>
          <Button type="submit" disabled={submitting || !query.trim()}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate grounded code
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
