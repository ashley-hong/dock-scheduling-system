import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Harborview Dock Scheduler",
  description: "Berth reservation management for the Harborview waterfront.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-white font-sans text-[#0a0a0a]">
        <header className="border-b border-[#e5e5e5]">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-[16px] font-bold tracking-tight">
              Harborview Dock Scheduler
            </Link>
            <nav className="flex gap-7 text-[13px] font-medium text-[#6b7280]">
              <Link href="/" className="transition-colors hover:text-[#0a0a0a]">
                Calendar
              </Link>
              <Link href="/berths" className="transition-colors hover:text-[#0a0a0a]">
                Berths
              </Link>
              <Link href="/data-quality" className="transition-colors hover:text-[#0a0a0a]">
                Data Quality
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
