import type { Metadata, Viewport } from 'next'
import { Inter, Fraunces } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['600'],
})

export const metadata: Metadata = {
  title: 'Farmstead — an on-chain farming game',
  description:
    'Plant, grow and harvest crops on a public blockchain. Your land, items and currency are tokens you actually own.',
  keywords: ['web3 game', 'farming game', 'NFT', 'GameFi', 'Sepolia', 'Ethereum'],
}

export const viewport: Viewport = {
  themeColor: '#100e0b',
  width: 'device-width',
  initialScale: 1,
  // The game canvas handles its own zoom; page pinch-zoom fights it.
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
