import fs from "node:fs/promises";
import path from "node:path";
import type { CloneLogEntry } from "./types";

export async function processGenericSite(
  html: string,
  targetUrl: string,
  destDir: string,
  emitLog: (entry: CloneLogEntry) => void
) {
  emitLog({ level: "info", message: "Processing high-fidelity site DOM & Styles...", timestamp: Date.now() });

  const urlObj = new URL(targetUrl);
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const siteTitle = titleMatch ? titleMatch[1].trim() : urlObj.hostname;

  const descMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);
  const siteDescription = descMatch ? descMatch[1].trim() : `High-fidelity clone of ${urlObj.hostname}`;

  emitLog({ level: "info", message: `Site metadata: "${siteTitle}"`, timestamp: Date.now() });

  // Ensure directories
  await fs.mkdir(path.join(destDir, "public/images"), { recursive: true });
  await fs.mkdir(path.join(destDir, "public/seo"), { recursive: true });
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
        
        // Rewrite relative URLs inside CSS (e.g. url(../media/font.woff2) or url('/font.woff2'))
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

  // 3. Download Favicon
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

  // 4. Extract Body HTML & Classes
  const bodyTagMatch = html.match(/<body[^>]*>/i);
  const bodyTag = bodyTagMatch ? bodyTagMatch[0] : "<body>";
  const bodyClasses = bodyTag.match(/class="([^"]*)"/i)?.[1] || "";

  const htmlTagMatch = html.match(/<html[^>]*>/i);
  const htmlTag = htmlTagMatch ? htmlTagMatch[0] : "<html>";
  const htmlClasses = htmlTag.match(/class="([^"]*)"/i)?.[1] || "";

  const bodyInnerMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let bodyContent = bodyInnerMatch ? bodyInnerMatch[1] : "";

  // Strip script tags and comments from body content to keep pure DOM
  bodyContent = bodyContent.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  bodyContent = bodyContent.replace(/<!--[\s\S]*?-->/g, "");

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

  // 5. Write high-fidelity styles
  const baseGlobals = `@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

/* Target Extracted Original Stylesheets */
${combinedExtractedCss}
`;

  await fs.writeFile(path.join(destDir, "src/app/globals.css"), baseGlobals);

  // 6. Write Root Layout preserving HTML and body classes
  await fs.writeFile(
    path.join(destDir, "src/app/layout.tsx"),
    `import type { Metadata } from "next";
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
      </body>
    </html>
  );
}
`
  );

  // 7. Write Page Component with exact rendered DOM tree
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
    message: `Synthesized pixel-exact layout and styles (${Math.round(combinedExtractedCss.length / 1024)} KB CSS)`,
    timestamp: Date.now(),
  });

  return {
    siteTitle,
    assetsCount: stylesheetMatches.length + 1,
    componentsCount: 1,
  };
}
