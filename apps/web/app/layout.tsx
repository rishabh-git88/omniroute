import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import { AuthProvider } from './auth-provider';
import { PRODUCT_NAME } from './brand';

export const metadata: Metadata = {
  description: 'A provider-neutral multi-LLM conversation workspace.',
  title: PRODUCT_NAME,
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
