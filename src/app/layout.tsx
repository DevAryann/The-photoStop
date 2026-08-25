import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Photobooth - Create Photo Strips Together",
  description: "Modern digital photobooth for creating nostalgic photo strips with friends. Capture, customize, and download in seconds.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
