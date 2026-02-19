import type { NextConfig } from 'next';
import withPWA from '@ducanh2912/next-pwa';

const nextConfig: NextConfig = {
  transpilePackages: ['rot-js'],
  turbopack: {}, // Silence Turbopack warning from PWA plugin's webpack config
};

export default withPWA({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  workboxOptions: {
    skipWaiting: true,
  },
})(nextConfig);
