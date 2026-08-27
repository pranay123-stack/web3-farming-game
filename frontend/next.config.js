const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The wire protocol lives outside the app directory and is shared with the
  // multiplayer server, so it has to be transpiled alongside app code.
  transpilePackages: [],

  webpack: (config, { isServer }) => {
    // Phaser touches `window` at import time and must never be pulled into the
    // server bundle. The game canvas is loaded with next/dynamic + ssr:false.
    if (isServer) {
      config.externals = [...(config.externals || []), 'phaser']
    }
    config.resolve.alias = {
      ...config.resolve.alias,
      '@/shared': path.resolve(__dirname, '../shared'),
    }
    return config
  },

  eslint: {
    // Lint runs as its own CI step; a lint warning should not fail a build.
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig
