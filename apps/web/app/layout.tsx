import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import { AuthProvider } from './auth-provider';

export const metadata: Metadata = {
  description: 'A provider-neutral multi-LLM conversation workspace.',
  title: 'OmniRoute',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
