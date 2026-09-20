import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { CloneRequest, CloneProgressEvent, CloneLogEntry } from "./types";
import { processCargoSite } from "./cargo";
import { processGenericSite } from "./generic";

const execAsync = promisify(exec);

export async function runCloneEngine(
  request: CloneRequest,
  onProgress: (event: CloneProgressEvent) => void
) {
  const emitLog = (entry: CloneLogEntry) => {
    onProgress({
      stage: "extract",
      percent: 40,
      log: entry,
    });
  };

  try {
    let targetUrl = request.url.trim();
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = `https://${targetUrl}`;
    }

    const rawDest = request.destPath.trim();
    const destDir = rawDest.startsWith("~")
      ? path.join(os.homedir(), rawDest.slice(1))
      : path.resolve(rawDest);

    onProgress({
      stage: "init",
      percent: 5,
      log: {
        level: "step",
        message: `Initializing clone: ${targetUrl} -> ${destDir}`,
        timestamp: Date.now(),
      },
    });

    // 1. Scaffolding
    onProgress({
      stage: "scaffold",
      percent: 15,
      log: {
        level: "info",
        message: "Scaffolding Next.js 16 project structure...",
        timestamp: Date.now(),
      },
    });

    await fs.mkdir(destDir, { recursive: true });

    // Root of current template
    const templateRoot = process.cwd();

    const filesToCopy = [
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "next.config.ts",
      "postcss.config.mjs",
      "eslint.config.mjs",
      "components.json",
    ];

    for (const file of filesToCopy) {
      try {
        await fs.copyFile(path.join(templateRoot, file), path.join(destDir, file));
      } catch {}
    }

    // Ensure src & public directories exist
    await fs.mkdir(path.join(destDir, "src/lib"), { recursive: true });
    await fs.mkdir(path.join(destDir, "src/app"), { recursive: true });
    await fs.mkdir(path.join(destDir, "src/components"), { recursive: true });
    await fs.mkdir(path.join(destDir, "public/seo"), { recursive: true });
    await fs.mkdir(path.join(destDir, "public/images"), { recursive: true });

    // Copy essential baseline assets from template
    const baseFiles = [
      { src: "src/lib/utils.ts", dest: "src/lib/utils.ts" },
      { src: "src/app/globals.css", dest: "src/app/globals.css" },
      { src: "src/app/favicon.ico", dest: "src/app/favicon.ico" },
      { src: "src/app/favicon.ico", dest: "public/favicon.ico" },
      { src: "src/app/favicon.ico", dest: "public/seo/favicon.ico" },
    ];

    for (const item of baseFiles) {
      try {
        await fs.copyFile(path.join(templateRoot, item.src), path.join(destDir, item.dest));
      } catch {}
    }

    // Hardlink or copy node_modules for instant builds (Turbopack compatible)
    const templateModules = path.join(templateRoot, "node_modules");
    const destModules = path.join(destDir, "node_modules");

    try {
      await fs.access(destModules);
    } catch {
      try {
        // Fast hardlinks: zero disk waste, instant, compatible with Turbopack
        await execAsync(`cp -al "${templateModules}" "${destModules}"`);
        onProgress({
          stage: "scaffold",
          percent: 25,
          log: {
            level: "info",
            message: "Linked shared dependencies (instant setup)",
            timestamp: Date.now(),
          },
        });
      } catch {
        try {
          await execAsync(`cp -a "${templateModules}" "${destModules}"`);
        } catch {
          onProgress({
            stage: "scaffold",
            percent: 25,
            log: {
              level: "warn",
              message: "Dependencies could not be copied; run npm install after creation.",
              timestamp: Date.now(),
            },
          });
        }
      }
    }

    // 2. Fetch Target
    onProgress({
      stage: "extract",
      percent: 30,
      log: {
        level: "step",
        message: `Fetching target document from ${targetUrl}...`,
        timestamp: Date.now(),
      },
    });

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch target URL: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();

    // 3. Extraction & Codegen
    onProgress({
      stage: "codegen",
      percent: 50,
      log: {
        level: "step",
        message: "Analyzing page structure and extracting assets...",
        timestamp: Date.now(),
      },
    });

    const isCargo =
      html.includes('data-set="ScaffoldingData"') ||
      html.includes("data-predefined-style") ||
      html.includes("cargo.site");

    let resultSummary: { siteTitle: string; assetsCount: number; componentsCount: number };

    if (isCargo) {
      resultSummary = await processCargoSite(html, destDir, emitLog);
    } else {
      resultSummary = await processGenericSite(html, targetUrl, destDir, emitLog);
    }

    // 4. Verification
    onProgress({
      stage: "verify",
      percent: 85,
      log: {
        level: "step",
        message: "Verifying TypeScript contracts and build integrity...",
        timestamp: Date.now(),
      },
    });

    try {
      await execAsync("npx tsc --noEmit", { cwd: destDir });
      onProgress({
        stage: "verify",
        percent: 95,
        log: {
          level: "success",
          message: "Typecheck passed cleanly with 0 errors.",
          timestamp: Date.now(),
        },
      });
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      onProgress({
        stage: "verify",
        percent: 95,
        log: {
          level: "warn",
          message: `Typecheck notice: ${errMsg.slice(0, 150)}`,
          timestamp: Date.now(),
        },
      });
    }

    // 5. Done
    onProgress({
      stage: "done",
      percent: 100,
      log: {
        level: "success",
        message: `Clone successfully created at ${destDir}!`,
        timestamp: Date.now(),
      },
      result: {
        destPath: destDir,
        siteTitle: resultSummary.siteTitle,
        assetsCount: resultSummary.assetsCount,
        componentsCount: resultSummary.componentsCount,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    onProgress({
      stage: "error",
      percent: 0,
      log: {
        level: "error",
        message: `Clone failed: ${message}`,
        timestamp: Date.now(),
      },
      error: message,
    });
  }
}
