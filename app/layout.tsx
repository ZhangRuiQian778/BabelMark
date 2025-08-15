import './globals.css';
import Providers from './providers';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BabelMark',
  description: 'Markdown translation that preserves structure',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
