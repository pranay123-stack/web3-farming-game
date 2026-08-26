/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    // Phaser requires these to be externalized on server
    if (isServer) {
      config.externals.push('phaser');
    }
    return config;
  },
}

module.exports = nextConfig
