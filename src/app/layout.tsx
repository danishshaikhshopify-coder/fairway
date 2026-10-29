import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { AppShell } from "@/components/layout/app-shell";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
  // Local/system fallback: if the self-hosted webfont ever fails to load, text
  // renders immediately in the platform UI stack instead of a serif default.
  fallback: [
    "system-ui",
    "-apple-system",
    "Segoe UI",
    "Roboto",
    "Helvetica Neue",
    "Arial",
    "sans-serif",
  ],
});

export const metadata: Metadata = {
  title: {
    default: "Fairway CRM",
    template: "%s | Fairway CRM",
  },
  description:
    "Prospecting and sales operations CRM for golf simulator businesses across the USA, Canada, and Mexico.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning applies to this element only, not children.
          Body attributes are a single static className, so nothing app-owned
          can be masked; this silences the React warning caused by browser
          extensions (e.g. Grammarly's data-gr-ext-installed) that inject
          attributes into <body> before hydration. Verified: the server-rendered
          body tag contains only the app's className. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Providers>
            <AppShell>{children}</AppShell>
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
