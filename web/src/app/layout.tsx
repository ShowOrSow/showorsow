import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { Geist, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "ShowOrSow — RSVPs with skin in the game",
  description:
    "Stake-to-attend events on Canton. Reserve your seat with a refundable token stake — get it back when you show up, forfeit it when you flake. Private by default.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn(geist.variable, geistMono.variable)}>
      <body className="font-sans antialiased">
        <Providers>
          <Header />
          <main className="min-h-[calc(100vh-3.5rem)]">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
