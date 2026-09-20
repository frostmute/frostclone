import fs from "node:fs/promises";
import path from "node:path";
import type { CloneLogEntry } from "./types";

export async function processGenericSite(
  html: string,
  targetUrl: string,
  destDir: string,
  emitLog: (entry: CloneLogEntry) => void
) {
  emitLog({ level: "info", message: "Processing site architecture, scripts & styles...", timestamp: Date.now() });

  const urlObj = new URL(targetUrl);
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const siteTitle = titleMatch ? titleMatch[1].trim() : urlObj.hostname;

  const descMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);
  const siteDescription = descMatch ? descMatch[1].trim() : `High-fidelity clone of ${urlObj.hostname}`;

  emitLog({ level: "info", message: `Site metadata: "${siteTitle}"`, timestamp: Date.now() });

  // Ensure directories
  await fs.mkdir(path.join(destDir, "public/images"), { recursive: true });
  await fs.mkdir(path.join(destDir, "public/seo"), { recursive: true });
  await fs.mkdir(path.join(destDir, "public/assets"), { recursive: true });
  await fs.mkdir(path.join(destDir, "src/components"), { recursive: true });

  // 1. Download & Extract all external stylesheets
  const stylesheetMatches = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/gi)];
  let combinedExtractedCss = "";

  for (const sm of stylesheetMatches) {
    try {
      const cssHref = sm[1];
      const cssUrl = new URL(cssHref, targetUrl).href;
      const res = await fetch(cssUrl);
      if (res.ok) {
        let text = await res.text();

        // Rewrite relative URLs inside CSS to absolute target URLs
        text = text.replace(/url\((['"]?)([^'")]+)\1\)/gi, (match, quote, relPath) => {
          if (relPath.startsWith("http://") || relPath.startsWith("https://") || relPath.startsWith("data:")) {
            return match;
          }
          try {
            const absoluteAssetUrl = new URL(relPath, cssUrl).href;
            return `url(${quote}${absoluteAssetUrl}${quote})`;
          } catch {
            return match;
          }
        });

        combinedExtractedCss += `\n/* Extracted from ${cssHref} */\n${text}\n`;
        emitLog({ level: "info", message: `Extracted external stylesheet: ${cssHref.split("/").pop()}`, timestamp: Date.now() });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      emitLog({ level: "warn", message: `Could not fetch stylesheet: ${msg}`, timestamp: Date.now() });
    }
  }

  // 2. Extract inline styles
  const inlineStyleMatches = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  for (const ism of inlineStyleMatches) {
    let text = ism[1];
    text = text.replace(/url\((['"]?)([^'")]+)\1\)/gi, (match, quote, relPath) => {
      if (relPath.startsWith("http://") || relPath.startsWith("https://") || relPath.startsWith("data:")) {
        return match;
      }
      try {
        const absoluteAssetUrl = new URL(relPath, targetUrl).href;
        return `url(${quote}${absoluteAssetUrl}${quote})`;
      } catch {
        return match;
      }
    });
    combinedExtractedCss += `\n/* Inline Style */\n${text}\n`;
  }

  // 3. Download Scripts (for client-rendered SPA bundles like Vite/React)
  const scriptMatches = [...html.matchAll(/<script[^>]+src="([^"]+)"[^>]*>/gi)];
  const localScriptTags: string[] = [];

  for (const sc of scriptMatches) {
    const rawSrc = sc[1];
    try {
      const scriptUrl = new URL(rawSrc, targetUrl).href;
      const fileName = path.basename(new URL(scriptUrl).pathname) || "bundle.js";
      const res = await fetch(scriptUrl);
      if (res.ok) {
        let scriptContent = await res.text();

        // Detect embedded relative image strings (e.g. src:"/images/foo.jpg") and download them locally
        const embeddedImageMatches = [...scriptContent.matchAll(/src:\s*["'](\/images\/[^"']+)["']/g)].map(m => m[1]);
        for (const relImg of embeddedImageMatches) {
          try {
            const remoteImgUrl = new URL(`.${relImg}`, targetUrl).href;
            const localImgDest = path.join(destDir, "public", relImg);
            await fs.mkdir(path.dirname(localImgDest), { recursive: true });
            const imgRes = await fetch(remoteImgUrl);
            if (imgRes.ok) {
              await fs.writeFile(localImgDest, Buffer.from(await imgRes.arrayBuffer()));
            }
          } catch {}
        }

        // Rewrite relative asset imports/fetches inside the script to absolute target URLs
        scriptContent = scriptContent.replace(/["']\.\/assets\/([^"']+)["']/g, (m, p) => {
          const absUrl = new URL(`./assets/${p}`, targetUrl).href;
          return `"${absUrl}"`;
        });

        await fs.writeFile(path.join(destDir, "public/assets", fileName), scriptContent);
        localScriptTags.push(`/assets/${fileName}`);
        emitLog({ level: "info", message: `Acquired and patched client bundle: ${fileName}`, timestamp: Date.now() });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      emitLog({ level: "warn", message: `Could not download script: ${msg}`, timestamp: Date.now() });
    }
  }

  // 4. Download Favicon
  const faviconMatch = html.match(/<link[^>]+rel="(?:shortcut icon|icon)"[^>]+href="([^"]+)"/i);
  if (faviconMatch) {
    try {
      const favUrl = new URL(faviconMatch[1], targetUrl).href;
      const res = await fetch(favUrl);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(path.join(destDir, "public/favicon.ico"), buf);
        emitLog({ level: "info", message: "Downloaded favicon", timestamp: Date.now() });
      }
    } catch {}
  }

  // 5. Extract Body HTML & Classes
  const bodyTagMatch = html.match(/<body[^>]*>/i);
  const bodyTag = bodyTagMatch ? bodyTagMatch[0] : "<body>";
  const bodyClasses = bodyTag.match(/class="([^"]*)"/i)?.[1] || "";

  const htmlTagMatch = html.match(/<html[^>]*>/i);
  const htmlTag = htmlTagMatch ? htmlTagMatch[0] : "<html>";
  const htmlClasses = htmlTag.match(/class="([^"]*)"/i)?.[1] || "";

  const bodyInnerMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let bodyContent = bodyInnerMatch ? bodyInnerMatch[1] : "";

  // Strip external script tags from body content (we manage execution in Next.js)
  bodyContent = bodyContent.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  bodyContent = bodyContent.replace(/<!--[\s\S]*?-->/g, "");

  // If body content is empty (e.g. `<div id="root"></div>` for SPA), ensure the root mounting node exists
  if (!bodyContent.trim() || bodyContent.includes('id="root"')) {
    bodyContent = '<div id="root"></div>';
  }

  // Rewriting relative image URLs to absolute
  bodyContent = bodyContent.replace(/(<img[^>]+src=")([^"]+)(")/gi, (match, p1, p2, p3) => {
    if (p2.startsWith("http://") || p2.startsWith("https://") || p2.startsWith("data:")) {
      return match;
    }
    const absUrl = new URL(p2, targetUrl).href;
    return `${p1}${absUrl}${p3}`;
  });

  // Rewriting relative anchor hrefs
  bodyContent = bodyContent.replace(/(<a[^>]+href=")([^"]+)(")/gi, (match, p1, p2, p3) => {
    if (p2.startsWith("http://") || p2.startsWith("https://") || p2.startsWith("#") || p2.startsWith("mailto:") || p2.startsWith("tel:")) {
      return match;
    }
    const absUrl = new URL(p2, targetUrl).href;
    return `${p1}${absUrl}${p3}`;
  });

  // 6. Write high-fidelity styles
  const baseGlobals = `@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

/* Target Extracted Original Stylesheets */
${combinedExtractedCss}
`;

  await fs.writeFile(path.join(destDir, "src/app/globals.css"), baseGlobals);

  // 7. Write Root Layout preserving HTML and body classes
  await fs.writeFile(
    path.join(destDir, "src/app/layout.tsx"),
    `import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: ${JSON.stringify(siteTitle)},
  description: ${JSON.stringify(siteDescription)},
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={${JSON.stringify(htmlClasses)}}>
      <body className={${JSON.stringify(bodyClasses)}}>
        {children}
        ${localScriptTags.map((src) => `<Script src="${src}" type="module" strategy="afterInteractive" />`).join("\n        ")}
      </body>
    </html>
  );
}
`
  );

  // 8. Write Page Component with exact rendered DOM tree
  await fs.writeFile(
    path.join(destDir, "src/app/page.tsx"),
    `export default function Home() {
  return (
    <div
      id="cloned-root"
      dangerouslySetInnerHTML={{
        __html: ${JSON.stringify(bodyContent)},
      }}
    />
  );
}
`
  );

  emitLog({
    level: "success",
    message: `Synthesized pixel-exact layout, scripts & styles (${localScriptTags.length} bundles, ${Math.round(combinedExtractedCss.length / 1024)} KB CSS)`,
    timestamp: Date.now(),
  });

  return {
    siteTitle,
    assetsCount: stylesheetMatches.length + localScriptTags.length + 1,
    componentsCount: 1,
  };
}
