import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import LayoutWrapper from './layout-wrapper';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Concordia Agribusiness Corporation ERP',
  description: 'Engineering & Supply Chain Warehouse Management System',
  icons: {
    icon: '/concordia-logo.png',
    shortcut: '/concordia-logo.png',
    apple: '/concordia-logo.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <LayoutWrapper>{children}</LayoutWrapper>
      </body>
    </html>
  );
}
