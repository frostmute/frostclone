import fs from "node:fs/promises";
import path from "node:path";
import type { CloneLogEntry } from "./types";

interface GenericSection {
  title?: string;
  description?: string;
  items: Array<{
    title: string;
    description: string;
    imageUrl?: string;
  }>;
}

export async function processGenericSite(
  html: string,
  targetUrl: string,
  destDir: string,
  emitLog: (entry: CloneLogEntry) => void
) {
  emitLog({ level: "info", message: "Processing generic site structure...", timestamp: Date.now() });

  const urlObj = new URL(targetUrl);
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const siteTitle = titleMatch ? titleMatch[1].trim() : urlObj.hostname;

  const descMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);
  const siteDescription = descMatch ? descMatch[1].trim() : `Clone of ${urlObj.hostname}`;

  emitLog({ level: "info", message: `Site metadata: "${siteTitle}"`, timestamp: Date.now() });

  // Ensure directories
  await fs.mkdir(path.join(destDir, "public/images"), { recursive: true });
  await fs.mkdir(path.join(destDir, "public/seo"), { recursive: true });
  await fs.mkdir(path.join(destDir, "src/components"), { recursive: true });

  // Download Favicon to public/favicon.ico
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

  // Extract navigation links
  const navLinks: Array<{ label: string; href: string }> = [];
  const navMatch = html.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
  if (navMatch) {
    const linkMatches = [...navMatch[1].matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi)];
    for (const lm of linkMatches) {
      const href = lm[1];
      const label = lm[2].trim();
      if (label && !href.startsWith("#") && !href.startsWith("javascript:")) {
        navLinks.push({ label, href });
      }
    }
  }

  // Extract main headings (ignoring aria-hidden animation duplicate spans)
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Inner = h1Match ? h1Match[1].replace(/<[^>]+aria-hidden="true"[^>]*>[\s\S]*?<\/[^>]+>/gi, "") : "";
  const heroHeading = (h1Inner ? h1Inner.replace(/<[^>]+>/g, " ").trim() : (h1Match ? h1Match[1].replace(/<[^>]+>/g, " ").trim() : siteTitle)).replace(/\s+/g, " ");
  const pMatches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  let heroSubheading = "";
  for (const pm of pMatches) {
    const text = pm[1].replace(/<[^>]+>/g, "").trim();
    if (text.length > 20 && text.length < 240) {
      heroSubheading = text;
      break;
    }
  }

  // Extract images
  const imgMatches = [...html.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/gi)];
  const extractedImages: string[] = [];
  for (const im of imgMatches) {
    try {
      const rawSrc = im[1];
      if (rawSrc.startsWith("data:")) continue;
      const fullImgUrl = new URL(rawSrc, targetUrl).href;
      if (!extractedImages.includes(fullImgUrl) && extractedImages.length < 12) {
        extractedImages.push(fullImgUrl);
      }
    } catch {}
  }

  emitLog({ level: "info", message: `Discovered ${extractedImages.length} primary images`, timestamp: Date.now() });

  // Download sample images
  const localImagePaths: string[] = [];
  for (let i = 0; i < extractedImages.length; i++) {
    const imgUrl = extractedImages[i];
    const ext = path.extname(new URL(imgUrl).pathname) || ".jpg";
    const localName = `asset-${i + 1}${ext}`;
    try {
      const res = await fetch(imgUrl);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(path.join(destDir, "public/images", localName), buf);
        localImagePaths.push(`/images/${localName}`);
      }
    } catch {
      localImagePaths.push(imgUrl);
    }
  }

  // Extract feature cards / sections
  const h2Matches = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
  const sections: GenericSection[] = [];
  const cardItems: Array<{ title: string; description: string; imageUrl?: string }> = [];

  for (let i = 0; i < Math.min(h2Matches.length, 6); i++) {
    const h2Text = h2Matches[i][1].replace(/<[^>]+>/g, "").trim();
    if (h2Text.length > 2) {
      cardItems.push({
        title: h2Text,
        description: `Experience ${h2Text} with high fidelity and responsive layout.`,
        imageUrl: localImagePaths[i % localImagePaths.length] || undefined,
      });
    }
  }

  if (cardItems.length > 0) {
    sections.push({
      title: "Featured Highlights",
      description: "Carefully extracted content and visual layout.",
      items: cardItems,
    });
  }

  // Write Navigation Component
  await fs.writeFile(
    path.join(destDir, "src/components/Header.tsx"),
    `import Link from "next/link";

interface NavLink {
  label: string;
  href: string;
}

const navLinks: NavLink[] = ${JSON.stringify(navLinks.length ? navLinks : [
  { label: "Home", href: "/" },
  { label: "About", href: "#about" },
  { label: "Work", href: "#work" },
  { label: "Contact", href: "#contact" }
])};

export function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-black/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6">
        <Link href="/" className="font-bold tracking-tight text-xl text-white hover:opacity-90">
          ${siteTitle}
        </Link>
        <nav className="flex items-center gap-6">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-sm font-medium text-neutral-300 hover:text-white transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
`
  );

  // Write Hero Component
  await fs.writeFile(
    path.join(destDir, "src/components/Hero.tsx"),
    `export function Hero() {
  return (
    <section className="py-20 sm:py-28 px-4 sm:px-6 text-center max-w-4xl mx-auto">
      <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white mb-6">
        ${heroHeading}
      </h1>
      <p className="text-lg sm:text-xl text-neutral-400 max-w-2xl mx-auto leading-relaxed mb-8">
        ${heroSubheading || "Pixel-perfect clone engineered with Next.js and Tailwind CSS."}
      </p>
      <div className="flex items-center justify-center gap-4">
        <a
          href="#explore"
          className="rounded-full bg-white text-black px-6 py-3 font-semibold text-sm hover:bg-neutral-200 transition-colors"
        >
          Explore Work
        </a>
      </div>
    </section>
  );
}
`
  );

  // Write Grid Component
  await fs.writeFile(
    path.join(destDir, "src/components/FeatureGrid.tsx"),
    `interface FeatureCard {
  title: string;
  description: string;
  imageUrl?: string;
}

const cards: FeatureCard[] = ${JSON.stringify(cardItems.length ? cardItems : [
      { title: "Visual Design", description: "Faithfully recreated styling and component hierarchy." },
      { title: "Responsive Layout", description: "Adapts to mobile, tablet, and widescreen monitors." },
      { title: "Next.js Engine", description: "Built with React 19, Tailwind v4, and modern standards." }
    ])};

export function FeatureGrid() {
  return (
    <section id="explore" className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {cards.map((card, idx) => (
          <div
            key={idx}
            className="group rounded-2xl border border-white/10 bg-neutral-950 p-6 hover:border-white/20 transition-colors"
          >
            {card.imageUrl && (
              <div className="w-full aspect-[4/3] rounded-xl overflow-hidden mb-4 bg-neutral-900">
                <img
                  src={card.imageUrl}
                  alt={card.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>
            )}
            <h3 className="text-xl font-bold text-white mb-2">{card.title}</h3>
            <p className="text-sm text-neutral-400 leading-relaxed">{card.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
`
  );

  // Write Footer
  await fs.writeFile(
    path.join(destDir, "src/components/Footer.tsx"),
    `export function Footer() {
  return (
    <footer className="border-t border-white/10 py-12 px-4 sm:px-6 text-center text-sm text-neutral-500">
      <p>Cloned with Frostclone • Original source: ${urlObj.hostname}</p>
    </footer>
  );
}
`
  );

  // Write Page
  await fs.writeFile(
    path.join(destDir, "src/app/page.tsx"),
    `import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { FeatureGrid } from "@/components/FeatureGrid";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-white selection:bg-white selection:text-black">
      <Header />
      <main>
        <Hero />
        <FeatureGrid />
      </main>
      <Footer />
    </div>
  );
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
  description: ${JSON.stringify(siteDescription)},
  icons: {
    icon: "/seo/favicon.ico",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full dark">
      <body className="min-h-full bg-black text-white antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
`
  );

  return {
    siteTitle,
    assetsCount: localImagePaths.length,
    componentsCount: 4,
  };
}
