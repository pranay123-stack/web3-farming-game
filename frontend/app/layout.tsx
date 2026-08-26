import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'GameFi Farming - Play to Earn',
  description: 'A blockchain-powered farming game where you can grow, harvest, and trade crops as NFTs',
  keywords: ['GameFi', 'farming', 'blockchain', 'NFT', 'play to earn', 'crypto game'],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-gradient-to-b from-game-dark to-game-darker">
          {children}
        </div>
      </body>
    </html>
  )
}
