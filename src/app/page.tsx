"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import type { CloneLogEntry, CloneProgressEvent } from "@/lib/cloner/types";

export default function Home() {
  const [url, setUrl] = useState("");
  const [destPath, setDestPath] = useState("~/Projects/");
  const [hasCustomDest, setHasCustomDest] = useState(false);
  const [linkModules, setLinkModules] = useState(true);

  const [isRunning, setIsRunning] = useState(false);
  const [currentStage, setCurrentStage] = useState<string>("idle");
  const [percent, setPercent] = useState(0);
  const [logs, setLogs] = useState<CloneLogEntry[]>([]);
  const [result, setResult] = useState<CloneProgressEvent["result"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const terminalEndRef = useRef<HTMLDivElement>(null);
  const [, startTransition] = useTransition();

  // Auto-slug destination folder from URL if user hasn't typed custom path
  const handleUrlChange = (newUrl: string) => {
    setUrl(newUrl);
    if (!hasCustomDest) {
      try {
        const parsed = new URL(newUrl.startsWith("http") ? newUrl : `https://${newUrl}`);
        const hostname = parsed.hostname.replace(/^www\./, "");
        const slug = hostname.split(".")[0] || "clone";
        setDestPath(`~/Projects/${slug}`);
      } catch {
        if (!newUrl) setDestPath("~/Projects/");
      }
    }
  };

  const handleDestChange = (newDest: string) => {
    setDestPath(newDest);
    setHasCustomDest(true);
  };

  const handleQuickUrl = (quickUrl: string) => {
    handleUrlChange(quickUrl);
  };

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleStartClone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !destPath.trim() || isRunning) return;

    setIsRunning(true);
    setCurrentStage("init");
    setPercent(5);
    setLogs([]);
    setResult(null);
    setError(null);

    try {
      const response = await fetch("/api/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          destPath: destPath.trim(),
          options: { linkModules },
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as CloneProgressEvent;
            startTransition(() => {
              setCurrentStage(event.stage);
              setPercent(event.percent);

              if (event.log) {
                setLogs((prev) => [...prev, event.log!]);
              }

              if (event.result) {
                setResult(event.result);
                setIsRunning(false);
              }

              if (event.error) {
                setError(event.error);
                setIsRunning(false);
              }
            });
          } catch {}
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setIsRunning(false);
    }
  };

  const handleCopyCommand = () => {
    if (!result?.destPath) return;
    navigator.clipboard.writeText(`cd ${result.destPath} && npm run dev`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setUrl("");
    setDestPath("~/Projects/");
    setHasCustomDest(false);
    setIsRunning(false);
    setCurrentStage("idle");
    setPercent(0);
    setLogs([]);
    setResult(null);
    setError(null);
  };

  const stages = [
    { key: "scaffold", label: "Scaffold" },
    { key: "extract", label: "Extract" },
    { key: "codegen", label: "Codegen" },
    { key: "verify", label: "Verify" },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100 font-sans selection:bg-blue-600 selection:text-white">
      {/* Background Glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-blue-600/10 blur-[140px] rounded-full" />
      </div>

      <div className="relative max-w-4xl mx-auto px-4 py-12 sm:px-6 lg:py-16">
        {/* Header */}
        <header className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-blue-500/20 bg-blue-500/10 text-blue-400 text-xs font-mono mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            STANDALONE INGESTION ENGINE
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white mb-3">
            Frostclone
          </h1>
          <p className="text-neutral-400 text-base sm:text-lg max-w-xl mx-auto">
            Clone any website into a standalone Next.js 16 codebase with exact styles, typography, and extracted assets.
          </p>
        </header>

        {/* Input Form Card */}
        <div className="rounded-2xl border border-white/10 bg-neutral-900/60 backdrop-blur-xl p-6 sm:p-8 shadow-2xl mb-8">
          <form onSubmit={handleStartClone} className="space-y-6">
            <div>
              <label htmlFor="url-input" className="block text-sm font-semibold text-neutral-200 mb-2">
                Target Website URL
              </label>
              <div className="relative">
                <input
                  id="url-input"
                  type="text"
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder="https://1987.graphics"
                  required
                  disabled={isRunning}
                  className="w-full px-4 py-3.5 rounded-xl border border-white/10 bg-black/40 text-white placeholder-neutral-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono text-sm sm:text-base disabled:opacity-50"
                />
              </div>

              {/* Preset suggestion chips */}
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <span className="text-xs text-neutral-500">Quick tests:</span>
                <button
                  type="button"
                  onClick={() => handleQuickUrl("https://1987.graphics")}
                  className="text-xs px-2.5 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-neutral-300 transition-colors"
                >
                  1987.graphics
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickUrl("https://cargo.site")}
                  className="text-xs px-2.5 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-neutral-300 transition-colors"
                >
                  cargo.site
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickUrl("https://news.ycombinator.com")}
                  className="text-xs px-2.5 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-neutral-300 transition-colors"
                >
                  news.ycombinator.com
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="dest-input" className="block text-sm font-semibold text-neutral-200 mb-2">
                Local Clone Destination
              </label>
              <input
                id="dest-input"
                type="text"
                value={destPath}
                onChange={(e) => handleDestChange(e.target.value)}
                placeholder="~/Projects/my-clone"
                required
                disabled={isRunning}
                className="w-full px-4 py-3.5 rounded-xl border border-white/10 bg-black/40 text-white placeholder-neutral-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono text-sm sm:text-base disabled:opacity-50"
              />
              <p className="text-xs text-neutral-500 mt-1.5">
                The clone will be created as a completely independent, runnable project at this path.
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-white/5">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={linkModules}
                  onChange={(e) => setLinkModules(e.target.checked)}
                  disabled={isRunning}
                  className="w-4 h-4 rounded border-neutral-700 bg-neutral-800 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs sm:text-sm text-neutral-400">
                  Link local dependencies (instant setup, saves ~400MB disk)
                </span>
              </label>

              <button
                type="submit"
                disabled={isRunning || !url.trim() || !destPath.trim()}
                className="px-6 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm sm:text-base transition-all shadow-lg shadow-blue-600/25 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
              >
                {isRunning ? (
                  <>
                    <svg className="animate-spin w-4 h-4 text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Ingesting...
                  </>
                ) : (
                  <>
                    <span>Start Ingestion</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Progress Tracker */}
          {(isRunning || percent > 0) && (
            <div className="mt-8 pt-6 border-t border-white/10 space-y-4">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-neutral-400 uppercase tracking-wider">
                  Stage: <span className="text-white font-semibold">{currentStage}</span>
                </span>
                <span className="text-blue-400 font-semibold">{percent}%</span>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden border border-white/5">
                <div
                  className="h-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>

              {/* Step Badges */}
              <div className="grid grid-cols-4 gap-2 pt-1">
                {stages.map((st) => {
                  const isDone = percent === 100 || (percent >= 85 && st.key !== "verify");
                  const isActive = currentStage === st.key;
                  return (
                    <div
                      key={st.key}
                      className={`text-center py-1.5 px-1 rounded-lg text-xs font-mono border transition-all ${
                        isDone
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : isActive
                          ? "border-blue-500/40 bg-blue-500/15 text-blue-300 animate-pulse"
                          : "border-white/5 bg-white/5 text-neutral-500"
                      }`}
                    >
                      {st.label}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Live Terminal Log Viewer */}
        {logs.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-black/80 backdrop-blur-xl overflow-hidden shadow-2xl mb-8">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-neutral-900/60">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/70" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/70" />
                <span className="text-xs font-mono text-neutral-400 ml-2">Console Output</span>
              </div>
              <span className="text-xs font-mono text-neutral-500">{logs.length} entries</span>
            </div>

            <div className="p-4 font-mono text-xs max-h-64 overflow-y-auto space-y-1.5">
              {logs.map((log, idx) => (
                <div key={idx} className="flex items-start gap-2 leading-relaxed">
                  <span className="text-neutral-600 select-none">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className={
                      log.level === "success"
                        ? "text-emerald-400"
                        : log.level === "error"
                        ? "text-red-400"
                        : log.level === "warn"
                        ? "text-yellow-400"
                        : log.level === "step"
                        ? "text-blue-400 font-bold"
                        : "text-neutral-300"
                    }
                  >
                    {log.message}
                  </span>
                </div>
              ))}
              <div ref={terminalEndRef} />
            </div>
          </div>
        )}

        {/* Error Notification */}
        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5 mb-8 flex items-start gap-3">
            <div className="text-red-400 font-bold">✕</div>
            <div>
              <h4 className="text-sm font-semibold text-red-400">Clone Operation Failed</h4>
              <p className="text-xs text-red-300/80 mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Success Card */}
        {result && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 backdrop-blur-xl p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-lg">
                ✓
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Ingestion Complete</h3>
                <p className="text-xs text-emerald-400/90 font-mono">
                  {result.siteTitle} is ready at {result.destPath}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono text-xs">
              <div className="p-3 rounded-xl bg-black/40 border border-emerald-500/20">
                <span className="text-neutral-500 block">Site Title</span>
                <span className="text-white font-semibold truncate block mt-0.5">{result.siteTitle}</span>
              </div>
              <div className="p-3 rounded-xl bg-black/40 border border-emerald-500/20">
                <span className="text-neutral-500 block">Extracted Assets</span>
                <span className="text-emerald-400 font-semibold block mt-0.5">{result.assetsCount} items</span>
              </div>
              <div className="p-3 rounded-xl bg-black/40 border border-emerald-500/20 col-span-2 sm:col-span-1">
                <span className="text-neutral-500 block">Generated Components</span>
                <span className="text-white font-semibold block mt-0.5">{result.componentsCount} modules</span>
              </div>
            </div>

            <div className="pt-2">
              <label className="block text-xs font-mono text-neutral-400 mb-2">
                Launch your clone locally:
              </label>
              <div className="flex items-center gap-2 p-2 rounded-xl bg-black/60 border border-white/10 font-mono text-xs text-neutral-200">
                <span className="text-emerald-400 select-none">$</span>
                <span className="flex-1 truncate">cd {result.destPath} &amp;&amp; npm run dev</span>
                <button
                  type="button"
                  onClick={handleCopyCommand}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs transition-colors shrink-0"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={handleReset}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-neutral-300 text-xs font-medium transition-colors"
              >
                Clone Another Site
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
