import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WPCloud — Self-Hosted WordPress, Nginx & Mail Control Panel",
  description:
    "Private Ubuntu 24.04 control panel for deploying, importing, and managing WordPress sites, automated Nginx configs, Let's Encrypt SSL, and Titan/Stalwart email.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#FAFAFB] text-slate-900 antialiased selection:bg-indigo-100 selection:text-indigo-900">
        {children}
      </body>
    </html>
  );
}
