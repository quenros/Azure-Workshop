// frontend/next.config.mjs (or next.config.js)

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        // Route internally to the Flask server running in the same Docker container
        destination: 'http://127.0.0.1:5000/api/:path*', 
      },
    ];
  },
};

export default nextConfig; // use "module.exports = nextConfig;" if using a .js file