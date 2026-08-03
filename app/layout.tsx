import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "HTML Translation Reconciler",
  description:
    "Merge a corrected translation into its original HTML structure.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-body-text">
        <div className="flex-1 flex flex-col">{children}</div>
        <footer className="border-t-2 border-line px-6 py-6 text-center text-sm text-body-text sm:px-10">
          <p className="mx-auto max-w-2xl">
            This tool is provided as-is with no warranty. Reconciliation is
            automated, so always review the result before publishing,
            especially when paragraphs were split, merged, or added.
            We&apos;re not responsible for broken, incorrect, or malformed
            results. Nothing you paste is stored. Everything runs in your
            browser.
          </p>
        </footer>
      </body>
    </html>
  );
}
