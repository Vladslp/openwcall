import "../styles/globals.css";
import type { Metadata } from "next";
import { TEXT } from "@openwcall/shared";

export const metadata: Metadata = {
  title: TEXT.appName,
  description: "Voice calls with WebRTC rooms."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100">
        {children}
      </body>
    </html>
  );
}
