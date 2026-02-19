import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import './globals.css';

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Crawler - AI Roguelike',
  description: 'An AI-native roguelike where LLMs play as dungeon master and adventurer',
  manifest: '/manifest.json',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${mono.variable} font-mono bg-[var(--bg-deep)] text-[var(--text)] min-h-screen vignette`}>
        {children}
      </body>
    </html>
  );
}
