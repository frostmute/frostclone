# Frostclone Architecture & Engine Specification

This document details the internal architecture, event streaming contracts, and extension points of the Frostclone ingestion platform.

---

## 1. System Overview

Frostclone is structured into three distinct tiers:

1. **Presentation Tier (`src/app/page.tsx`):**
   - React 19 Client Component using Server-Sent Events (SSE) consumer via `ReadableStreamDefaultReader`.
   - Dynamic path slugging and auto-scrolling terminal logs.
2. **Transportation Tier (`src/app/api/clone/route.ts`):**
   - Next.js dynamic Route Handler that converts the engine's internal progress events into `text/event-stream` chunks.
3. **Execution Tier (`src/lib/cloner/`):**
   - Orchestrator (`engine.ts`) managing the filesystem lifecycle and delegating to specialized extraction engines (`cargo.ts`, `generic.ts`).

---

## 2. Ingestion Lifecycle

```
[User Request: URL + Destination]
           │
           ▼
[1. Initialization & Path Normalization]
     - Resolves `~` to `os.homedir()`
     - Normalizes protocol (`https://`)
           │
           ▼
[2. Filesystem Scaffolding]
     - Copies base config files (`package.json`, `tsconfig.json`, etc.)
     - Creates `src/app`, `src/components`, `src/lib`, `public/images`, etc.
     - Hardlinks `node_modules` via `cp -al` (Turbopack compatible, ~0.2s)
           │
           ▼
[3. Target Acquisition]
     - HTTP GET request with modern browser user-agent
     - Full document text buffer inspection
           │
           ▼
[4. Platform Detection]
     ├── Cargo Collective: `cargo.site` / `data-set="ScaffoldingData"`
     │     └── Executes `processCargoSite()`
     └── Generic HTML: Semantic DOM detection
           └── Executes `processGenericSite()`
           │
           ▼
[5. Asset Acquisition & Codegen]
     - Downloads fonts, icons, cursors, images
     - Writes typed components (`Header`, `GalleryView`, `BottomLogo`, etc.)
     - Injects styling into `src/app/globals.css` and `src/app/layout.tsx`
           │
           ▼
[6. Integrity Verification]
     - Runs `npx tsc --noEmit` inside the new destination directory
           │
           ▼
[7. Completion Event Emitted]
     - Streams final statistics (Title, Assets count, Component count)
```

---

## 3. Streaming Event Protocol

All progress events emitted by `/api/clone` adhere to the `CloneProgressEvent` interface:

```typescript
export interface CloneProgressEvent {
  stage: "init" | "scaffold" | "extract" | "assets" | "codegen" | "verify" | "done" | "error";
  percent: number;
  log?: {
    level: "info" | "success" | "warn" | "error" | "step";
    message: string;
    timestamp: number;
  };
  result?: {
    destPath: string;
    siteTitle: string;
    assetsCount: number;
    componentsCount: number;
  };
  error?: string;
}
```

---

## 4. Extensibility: Adding a New Extractor

To support additional website platforms (e.g., Webflow, Squarespace, Shopify, WordPress):

1. **Create an Extractor Module in `src/lib/cloner/<platform>.ts`:**
   Implement a processing function:
   ```typescript
   export async function processPlatformSite(
     html: string,
     targetUrl: string,
     destDir: string,
     emitLog: (entry: CloneLogEntry) => void
   ): Promise<{ siteTitle: string; assetsCount: number; componentsCount: number }>
   ```

2. **Register in `src/lib/cloner/engine.ts`:**
   Add a detection condition in the platform detector step:
   ```typescript
   if (isCargo) {
     resultSummary = await processCargoSite(html, destDir, emitLog);
   } else if (isPlatform(html)) {
     resultSummary = await processPlatformSite(html, targetUrl, destDir, emitLog);
   } else {
     resultSummary = await processGenericSite(html, targetUrl, destDir, emitLog);
   }
   ```

---

## 5. Turbopack & Hardlinking Design

Next.js Turbopack strictly enforces that `node_modules` must not resolve to symlinks pointing outside the filesystem root of the application project. 

Frostclone solves this without duplicating ~400MB of dependencies per clone by using **filesystem hardlinks (`cp -al`)**. 

- On Linux/POSIX filesystems, hardlinked directory entries point to the same underlying inodes.
- Creation is instantaneous (<0.2s).
- Zero additional disk space is consumed for shared dependencies.
- Turbopack perceives `node_modules` as standard local directory entries within the project root.
