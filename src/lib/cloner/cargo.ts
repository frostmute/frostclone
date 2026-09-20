import fs from "node:fs/promises";
import path from "node:path";
import type { CloneLogEntry } from "./types";

interface ScaffoldingPage {
  id: number;
  title: string;
  pin?: boolean;
  pin_options?: { position?: string; overlay?: boolean; fixed?: boolean };
  content?: string;
  content_no_html?: string;
  pages?: ScaffoldingPage[];
}

export async function processCargoSite(
  html: string,
  destDir: string,
  emitLog: (entry: CloneLogEntry) => void
) {
  emitLog({ level: "info", message: "Detected Cargo site architecture. Parsing data models...", timestamp: Date.now() });

  const getJson = <T>(name: string): T | null => {
    const m = html.match(new RegExp(`<script\\s+type="text\\/json"\\s+data-set="${name}"\\s*>([\\s\\S]*?)<\\/script>`));
    if (!m) return null;
    try {
      return JSON.parse(m[1]) as T;
    } catch {
      return null;
    }
  };

  const scaffolding = getJson<{ title?: string; pages?: ScaffoldingPage[] }>("ScaffoldingData");
  const displayOptions = getJson<{
    layout_options?: { bgcolor?: string };
    site_menu_options?: { custom_icon?: string };
  }>("DisplayOptions");
  const siteMenu = getJson<{ content?: string; title?: string }>("SiteMenu");

  const siteTitle = scaffolding?.title || "Cloned Site";
  emitLog({ level: "info", message: `Extracting site title: "${siteTitle}"`, timestamp: Date.now() });

  // Ensure directories in destination
  await fs.mkdir(path.join(destDir, "public/images"), { recursive: true });
  await fs.mkdir(path.join(destDir, "public/fonts"), { recursive: true });
  await fs.mkdir(path.join(destDir, "public/seo"), { recursive: true });
  await fs.mkdir(path.join(destDir, "src/components"), { recursive: true });
  await fs.mkdir(path.join(destDir, "src/lib"), { recursive: true });
  await fs.mkdir(path.join(destDir, "src/types"), { recursive: true });

  // Fetch stylesheet for custom cursors, scrollbars, fonts
  const stylesheetMatch = html.match(/<link[^>]+href="([^"]+stylesheet[^"]+)"/);
  let customCss = "";
  if (stylesheetMatch) {
    try {
      const cssRes = await fetch(stylesheetMatch[1]);
      if (cssRes.ok) {
        customCss = await cssRes.text();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      emitLog({ level: "warn", message: `Could not fetch stylesheet: ${msg}`, timestamp: Date.now() });
    }
  }
  const cursorBlackMatch = customCss.match(/url\("([^"]+cursor-black[^"]+)"\)/i);
  const cursorBlueMatch = customCss.match(/url\("([^"]+cur[s]?or-blue[^"]+)"\)/i);

  if (cursorBlackMatch) {
    try {
      const res = await fetch(cursorBlackMatch[1]);
      if (res.ok) {
        await fs.writeFile(path.join(destDir, "public/images/cursor-black.png"), Buffer.from(await res.arrayBuffer()));
        emitLog({ level: "info", message: "Downloaded default cursor", timestamp: Date.now() });
      }
    } catch {}
  }

  if (cursorBlueMatch) {
    try {
      const res = await fetch(cursorBlueMatch[1]);
      if (res.ok) {
        await fs.writeFile(path.join(destDir, "public/images/cursor-blue.png"), Buffer.from(await res.arrayBuffer()));
        emitLog({ level: "info", message: "Downloaded hover cursor", timestamp: Date.now() });
      }
    } catch {}
  }

  // Extract Fonts
  const fontMatches = [...html.matchAll(/url\("([^"]+Cargo-DiatypePlusVariable[^"]+)"\)/g)];
  for (const fm of fontMatches) {
    const fontUrl = fm[1];
    const fileName = fontUrl.split("/").pop() || "font.woff2";
    try {
      const res = await fetch(fontUrl);
      if (res.ok) {
        await fs.writeFile(path.join(destDir, `public/fonts/${fileName}`), Buffer.from(await res.arrayBuffer()));
        emitLog({ level: "info", message: `Downloaded font: ${fileName}`, timestamp: Date.now() });
      }
    } catch {}
  }

  // Extract Favicon
  const faviconMatch = html.match(/<link[^>]+rel="(?:shortcut icon|icon)"[^>]+href="([^"]+)"/i);
  if (faviconMatch) {
    try {
      const res = await fetch(faviconMatch[1]);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(path.join(destDir, "public/seo/favicon.ico"), buf);
        await fs.writeFile(path.join(destDir, "public/favicon.ico"), buf);
        await fs.writeFile(path.join(destDir, "src/app/favicon.ico"), buf);
      }
    } catch {}
  }

  // Extract Menu Icon
  const menuIconUrl = displayOptions?.site_menu_options?.custom_icon;
  if (menuIconUrl) {
    const fullUrl = menuIconUrl.startsWith("//") ? `https:${menuIconUrl}` : menuIconUrl;
    try {
      const res = await fetch(fullUrl);
      if (res.ok) {
        await fs.writeFile(path.join(destDir, "public/images/menu-icon.png"), Buffer.from(await res.arrayBuffer()));
        emitLog({ level: "info", message: "Downloaded menu toggle icon", timestamp: Date.now() });
      }
    } catch {}
  }

  // Find Pages: Logo Page (pinned bottom) and Work Page (image gallery)
  let logoImgUrl: string | null = null;
  let workContent: string = "";

  const pages = scaffolding?.pages || [];
  for (const p of pages) {
    if (p.pages) {
      for (const sub of p.pages) {
        if (sub.pin && sub.content) {
          const imgMatch = sub.content.match(/data-src="([^"]+)"/i) || sub.content.match(/src="([^"]+)"/i);
          if (imgMatch) logoImgUrl = imgMatch[1];
        } else if (sub.content?.includes("image-gallery")) {
          workContent = sub.content;
        }
      }
    } else if (p.pin && p.content) {
      const imgMatch = p.content.match(/data-src="([^"]+)"/i) || p.content.match(/src="([^"]+)"/i);
      if (imgMatch) logoImgUrl = imgMatch[1];
    } else if (p.content?.includes("image-gallery")) {
      workContent = p.content;
    }
  }

  if (logoImgUrl) {
    try {
      const res = await fetch(logoImgUrl);
      if (res.ok) {
        await fs.writeFile(path.join(destDir, "public/images/logo-bmp.png"), Buffer.from(await res.arrayBuffer()));
        emitLog({ level: "info", message: "Downloaded pinned logo", timestamp: Date.now() });
      }
    } catch {}
  }

  // Parse Gallery Blocks
  const blocks = workContent.split('<div class="image-gallery"').filter(Boolean);
  const galleries = blocks.map((block, idx) => {
    const configMatch = block.match(/data-gallery="([^"]+)"/);
    const config = configMatch ? JSON.parse(decodeURIComponent(configMatch[1])) : {};
    const content = block.replace(/data-gallery="[^"]+"/, "").replace(/^>/, "").replace(/<\/div>$/, "");

    const items: Array<{
      src: string;
      width: number;
      height: number;
      link: { href: string; target: string } | null;
      caption: string | null;
      mid: string | null;
    }> = [];

    const itemRegex = /(<a\s+[^>]*>[\s\S]*?<\/a>|<img\s+[^>]*>)/g;
    let m;
    while ((m = itemRegex.exec(content)) !== null) {
      const raw = m[1];
      let link: { href: string; target: string } | null = null;
      let imgTag = raw;
      if (raw.startsWith("<a")) {
        const href = raw.match(/href="([^"]+)"/)?.[1];
        const target = raw.match(/target="([^"]+)"/)?.[1];
        if (href) link = { href, target: target || "_blank" };
        imgTag = raw.match(/<img[^>]*>/)?.[0] || "";
      }
      const src = imgTag.match(/data-src="([^"]+)"/)?.[1] || imgTag.match(/src="([^"]+)"/)?.[1] || "";
      const width = parseInt(imgTag.match(/width="(\d+)"/)?.[1] || "0", 10);
      const height = parseInt(imgTag.match(/height="(\d+)"/)?.[1] || "0", 10);
      const caption = imgTag.match(/caption="([^"]+)"/)?.[1] || null;
      const mid = imgTag.match(/data-mid="([^"]+)"/)?.[1] || null;

      if (src) {
        items.push({ src, width, height, link, caption, mid });
      }
    }

    return {
      id: idx + 1,
      columns: parseInt(config.data?.columns || "2", 10),
      column_size: config.data?.column_size,
      image_padding: config.data?.image_padding || "0.5",
      items,
    };
  });

  emitLog({
    level: "success",
    message: `Extracted ${galleries.length} gallery blocks (${galleries.reduce((a, b) => a + b.items.length, 0)} total items)`,
    timestamp: Date.now(),
  });

  await fs.writeFile(path.join(destDir, "src/lib/gallery-data.json"), JSON.stringify(galleries, null, 2));

  // Write Gallery Type definition
  await fs.writeFile(
    path.join(destDir, "src/types/gallery.ts"),
    `export interface GalleryLink {
  href: string;
  target?: string;
}

export interface GalleryItem {
  src: string;
  width: number;
  height: number;
  link: GalleryLink | null;
  caption: string | null;
  mid: string | null;
}

export interface GalleryBlock {
  id: number;
  columns: number;
  column_size?: number;
  image_padding: string;
  items: GalleryItem[];
}
`
  );

  // Write BottomLogo Component
  await fs.writeFile(
    path.join(destDir, "src/components/BottomLogo.tsx"),
    `export function BottomLogo() {
  return (
    <aside
      aria-label="Studio Logo"
      className="fixed bottom-0 left-0 w-full pointer-events-none z-30 p-2 sm:p-4"
    >
      <div className="w-[60%] sm:w-[41.666%] max-w-[560px] min-w-[180px]">
        <img
          src="/images/logo-bmp.png"
          alt="Logo"
          width={1793}
          height={564}
          className="w-full h-auto block select-none pointer-events-auto"
        />
      </div>
    </aside>
  );
}
`
  );

  // Write Menu Component
  const menuContent = siteMenu?.content || "<div>1987 Studio</div>";
  await fs.writeFile(
    path.join(destDir, "src/components/Menu.tsx"),
    `"use client";

import { useState, useEffect } from "react";

export function Menu() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) setIsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? "Close menu" : "Open menu"}
        aria-expanded={isOpen}
        className="fixed top-4 right-4 z-50 p-1 select-none transition-transform active:scale-95 focus:outline-none"
      >
        <img
          src="/images/menu-icon.png"
          alt="Menu"
          width={50}
          height={50}
          className="w-[38px] h-[38px] sm:w-[50px] sm:h-[50px] block"
        />
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-40 bg-[#e1e1e1] text-black overflow-y-auto px-4 py-8 sm:px-8 sm:py-12 md:px-12 md:py-16"
        >
          <div
            className="max-w-4xl text-2xl sm:text-4xl md:text-5xl font-normal leading-[1.12] tracking-tight [&_a]:text-[#4f00ff] [&_a:hover]:text-black [&_hr]:border-0 [&_hr]:h-[1px] [&_hr]:bg-black [&_hr]:my-6"
            dangerouslySetInnerHTML={{ __html: ${JSON.stringify(menuContent)} }}
          />
        </div>
      )}
    </>
  );
}
`
  );

  // Write QuickView Component
  await fs.writeFile(
    path.join(destDir, "src/components/QuickView.tsx"),
    `"use client";

import { useEffect, useCallback } from "react";
import type { GalleryItem } from "@/types/gallery";

interface QuickViewProps {
  items: GalleryItem[];
  currentIndex: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function QuickView({ items, currentIndex, onClose, onNavigate }: QuickViewProps) {
  const isOpen = currentIndex !== null && currentIndex >= 0 && currentIndex < items.length;
  const currentItem = isOpen ? items[currentIndex] : null;

  const handlePrev = useCallback(() => {
    if (currentIndex === null) return;
    onNavigate(currentIndex === 0 ? items.length - 1 : currentIndex - 1);
  }, [currentIndex, items.length, onNavigate]);

  const handleNext = useCallback(() => {
    if (currentIndex === null) return;
    onNavigate(currentIndex === items.length - 1 ? 0 : currentIndex + 1);
  }, [currentIndex, items.length, onNavigate]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") handlePrev();
      else if (e.key === "ArrowRight") handleNext();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, handlePrev, handleNext]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen || !currentItem) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#e1e1e1] p-4 sm:p-8"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close"
        className="absolute top-3 right-3 sm:top-4 sm:right-4 z-50 p-2 text-black hover:opacity-70 focus:outline-none cursor-pointer"
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handlePrev();
        }}
        aria-label="Previous"
        className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 z-50 p-2 text-black hover:opacity-70 focus:outline-none cursor-pointer"
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleNext();
        }}
        aria-label="Next"
        className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 z-50 p-2 text-black hover:opacity-70 focus:outline-none cursor-pointer"
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      <div
        className="max-w-[90vw] max-h-[90vh] flex flex-col items-center justify-center pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={currentItem.src}
          alt={currentItem.caption || "Artwork"}
          width={currentItem.width}
          height={currentItem.height}
          className="max-w-[85vw] max-h-[78vh] object-contain select-none cursor-pointer"
          onClick={handleNext}
        />
        {currentItem.caption && (
          <div className="mt-4 text-left w-full font-mono text-xs sm:text-sm text-black tracking-tight">
            <span>{currentItem.caption}</span>
          </div>
        )}
      </div>
    </div>
  );
}
`
  );

  // Write GalleryView Component
  await fs.writeFile(
    path.join(destDir, "src/components/GalleryView.tsx"),
    `"use client";

import { useMemo } from "react";
import type { GalleryBlock } from "@/types/gallery";

interface GalleryViewProps {
  galleries: GalleryBlock[];
  onOpenQuickView: (index: number) => void;
}

export function GalleryView({ galleries, onOpenQuickView }: GalleryViewProps) {
  const itemIndexMap = useMemo(() => {
    let globalIndex = 0;
    const map: Record<string, number> = {};
    galleries.forEach((gallery) => {
      gallery.items.forEach((_, itemIdx) => {
        map[\`\${gallery.id}-\${itemIdx}\`] = globalIndex++;
      });
    });
    return map;
  }, [galleries]);

  const getGridClasses = (columns: number) => {
    switch (columns) {
      case 3:
        return "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-4";
      case 2:
        return "grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4";
      case 1:
      default:
        return "grid grid-cols-1 gap-2 sm:gap-4";
    }
  };

  return (
    <div className="w-full space-y-2 sm:space-y-4">
      {galleries.map((gallery) => (
        <section key={gallery.id} className={getGridClasses(gallery.columns)}>
          {gallery.items.map((item, itemIdx) => {
            const key = \`\${gallery.id}-\${itemIdx}\`;
            const flatIndex = itemIndexMap[key] ?? 0;

            if (item.link) {
              return (
                <div key={key} className="w-full">
                  <a
                    href={item.link.href}
                    target={item.link.target || "_blank"}
                    rel="noopener noreferrer"
                    className="block group focus:outline-none"
                  >
                    <img
                      src={item.src}
                      alt={item.caption || "Artwork"}
                      width={item.width}
                      height={item.height}
                      loading="lazy"
                      className="w-full h-auto block select-none group-hover:opacity-90 transition-opacity"
                    />
                  </a>
                  {item.caption && <p className="gallery_image_caption">{item.caption}</p>}
                </div>
              );
            }

            return (
              <div key={key} className="w-full">
                <button
                  type="button"
                  onClick={() => onOpenQuickView(flatIndex)}
                  className="w-full text-left block group focus:outline-none cursor-pointer"
                >
                  <img
                    src={item.src}
                    alt={item.caption || "Artwork"}
                    width={item.width}
                    height={item.height}
                    loading="lazy"
                    className="w-full h-auto block select-none group-hover:opacity-90 transition-opacity"
                  />
                </button>
                {item.caption && <p className="gallery_image_caption">{item.caption}</p>}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
`
  );

  // Write Globals CSS
  await fs.writeFile(
    path.join(destDir, "src/app/globals.css"),
    `@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@font-face {
  font-display: swap;
  font-family: "Diatype Variable";
  src: url("/fonts/Cargo-DiatypePlusVariable.woff2") format("woff2-variations");
  font-style: normal;
  font-weight: 200 1000;
}

@font-face {
  font-display: swap;
  font-family: "Diatype Variable";
  src: url("/fonts/Cargo-DiatypePlusVariable-Italic.woff2") format("woff2-variations");
  font-style: italic;
  font-weight: 200 1000;
}

@font-face {
  font-display: swap;
  font-family: "Diatype Mono Variable";
  src: url("/fonts/Cargo-DiatypePlusVariable.woff2") format("woff2-variations");
  font-style: normal;
  font-weight: 200 700;
}

@font-face {
  font-display: swap;
  font-family: "Diatype Mono Variable";
  src: url("/fonts/Cargo-DiatypePlusVariable-Italic.woff2") format("woff2-variations");
  font-style: italic;
  font-weight: 200 700;
}

@theme inline {
  --color-background: #000000;
  --color-foreground: #4f00ff;
  --font-sans: "Diatype Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "Diatype Mono Variable", ui-monospace, monospace;
}

:root {
  --background: #000000;
  --foreground: #4f00ff;
}

html, body {
  background-color: #000000;
  color: #4f00ff;
  cursor: url("/images/cursor-black.png"), auto !important;
  min-height: 100vh;
  margin: 0;
  padding: 0;
  -webkit-font-smoothing: antialiased;
}

a, button, [role="button"], .clickable {
  cursor: url("/images/cursor-blue.png"), auto !important;
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  background-color: rgb(225, 225, 225);
  border: 0px solid #000000;
}

::-webkit-scrollbar-thumb {
  background-color: rgb(79, 0, 255);
  border-radius: 0px;
  border: 1px solid #000000;
}

::-webkit-scrollbar-thumb:hover {
  background-color: #5b00ff;
}

.gallery_image_caption {
  margin-top: 0.6rem;
  margin-bottom: 0.4rem;
  font-size: 1.15rem;
  font-weight: 400;
  color: rgba(120, 120, 120, 1);
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-style: normal;
  line-height: 1.3;
}
`
  );

  // Write Layout
  await fs.writeFile(
    path.join(destDir, "src/app/layout.tsx"),
    `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: ${JSON.stringify(siteTitle)},
  description: ${JSON.stringify(`Pixel-perfect clone of ${siteTitle}`)},
  icons: {
    icon: "/seo/favicon.ico",
    shortcut: "/seo/favicon.ico",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-black text-[#4f00ff] selection:bg-[#4f00ff] selection:text-white">
        {children}
      </body>
    </html>
  );
}
`
  );

  // Write Page
  await fs.writeFile(
    path.join(destDir, "src/app/page.tsx"),
    `"use client";

import { useState, useMemo } from "react";
import galleriesData from "@/lib/gallery-data.json";
import type { GalleryBlock, GalleryItem } from "@/types/gallery";
import { GalleryView } from "@/components/GalleryView";
import { BottomLogo } from "@/components/BottomLogo";
import { Menu } from "@/components/Menu";
import { QuickView } from "@/components/QuickView";

const galleries = galleriesData as GalleryBlock[];

export default function Home() {
  const [quickViewIndex, setQuickViewIndex] = useState<number | null>(null);

  const flatItems = useMemo<GalleryItem[]>(
    () => galleries.flatMap((g) => g.items),
    []
  );

  return (
    <main className="min-h-screen bg-black text-[#4f00ff] p-2 sm:p-4 pb-32 sm:pb-44 relative">
      <Menu />
      <GalleryView galleries={galleries} onOpenQuickView={setQuickViewIndex} />
      <BottomLogo />
      <QuickView
        items={flatItems}
        currentIndex={quickViewIndex}
        onClose={() => setQuickViewIndex(null)}
        onNavigate={setQuickViewIndex}
      />
    </main>
  );
}
`
  );

  return {
    siteTitle,
    assetsCount: galleries.reduce((a, b) => a + b.items.length, 0),
    componentsCount: 4,
  };
}
