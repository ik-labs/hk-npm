import "./globals.css";
import type { Metadata } from "next";
import { DM_Sans, Space_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "NPM Intel",
  description: "Intent-driven npm package discovery with grounded code generation",
};

type RootLayoutProps = {
  children: React.ReactNode;
};

const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans", weight: ["400", "500", "700"] });
const serif = DM_Sans({ subsets: ["latin"], variable: "--font-serif", weight: ["400", "500", "700"] });
const mono = Space_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "700"] });

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body
        className={cn(
          "bg-background font-sans text-foreground",
          sans.variable,
          serif.variable,
          mono.variable,
        )}
      >
        {children}
      </body>
    </html>
  );
}
