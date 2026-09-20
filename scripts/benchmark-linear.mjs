import { performance } from "node:perf_hooks";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { runCloneEngine } from "../src/lib/cloner/engine.ts";

const execAsync = promisify(exec);

async function main() {
  const targetUrl = "https://linear.app";
  const destDir = path.join(os.homedir(), "Projects", "linear-clone");

  // Clean prior test
  try {
    await fs.rm(destDir, { recursive: true, force: true });
  } catch {}

  console.log(`\n========================================`);
  console.log(`  FROSTCLONE BENCHMARK: LINEAR.APP`);
  console.log(`========================================\n`);

  const metrics = {
    targetUrl,
    destDir,
    stages: {},
    assetsCount: 0,
    componentsCount: 0,
    siteTitle: "",
    diskUsageMB: 0,
    totalDurationMs: 0,
  };

  const startTime = performance.now();
  let lastCheckpoint = startTime;

  const onProgress = (event) => {
    const now = performance.now();
    const stageDuration = now - lastCheckpoint;

    if (event.log) {
      console.log(`[${event.stage.toUpperCase()}] (${Math.round(stageDuration)}ms) ${event.log.message}`);
    }

    if (!metrics.stages[event.stage]) {
      metrics.stages[event.stage] = {
        timestamp: now - startTime,
        duration: stageDuration,
      };
    }

    if (event.result) {
      metrics.assetsCount = event.result.assetsCount;
      metrics.componentsCount = event.result.componentsCount;
      metrics.siteTitle = event.result.siteTitle;
    }

    lastCheckpoint = now;
  };

  await runCloneEngine(
    {
      url: targetUrl,
      destPath: destDir,
      options: { linkModules: true },
    },
    onProgress
  );

  const totalTime = performance.now() - startTime;
  metrics.totalDurationMs = totalTime;

  // Measure disk usage of output
  try {
    const { stdout } = await execAsync(`du -sm "${destDir}"`);
    metrics.diskUsageMB = parseFloat(stdout.trim().split("\t")[0]);
  } catch {}

  // Measure build time of generated clone
  console.log(`\nVerifying Next.js 16 build inside ${destDir}...`);
  const buildStart = performance.now();
  let buildSuccess = false;
  try {
    await execAsync("npm run build", { cwd: destDir });
    buildSuccess = true;
    console.log(`✓ Generated clone compiled cleanly in ${Math.round(performance.now() - buildStart)}ms`);
  } catch (e) {
    console.error(`✕ Build notice: ${e.message}`);
  }

  metrics.buildSuccess = buildSuccess;
  metrics.buildTimeMs = performance.now() - buildStart;

  await fs.mkdir("docs/case-study", { recursive: true });
  await fs.writeFile("docs/case-study/benchmark-data.json", JSON.stringify(metrics, null, 2));

  console.log(`\n========================================`);
  console.log(`  BENCHMARK SUMMARY`);
  console.log(`========================================`);
  console.log(`Target:             ${metrics.targetUrl}`);
  console.log(`Site Title:         ${metrics.siteTitle}`);
  console.log(`Ingestion Time:     ${(metrics.totalDurationMs / 1000).toFixed(2)}s`);
  console.log(`Build Time:         ${(metrics.buildTimeMs / 1000).toFixed(2)}s`);
  console.log(`Extracted Assets:   ${metrics.assetsCount}`);
  console.log(`Disk Footprint:     ${metrics.diskUsageMB} MB`);
  console.log(`Build Integrity:    ${buildSuccess ? "PASS" : "FAIL"}`);
  console.log(`========================================\n`);
}

main().catch(console.error);
