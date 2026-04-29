const runtimeWatchIgnoredPattern = /(^|[\\/])(data|uploads)([\\/]|$)/;

function mergeWatchIgnored(ignored) {
  if (!ignored) return runtimeWatchIgnoredPattern;
  if (ignored instanceof RegExp) {
    return new RegExp(`${ignored.source}|${runtimeWatchIgnoredPattern.source}`);
  }
  if (Array.isArray(ignored)) {
    return [...ignored, "**/data/**", "**/uploads/**"];
  }
  return [ignored, "**/data/**", "**/uploads/**"];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ["192.168.1.252"],
  webpack(config, { dev }) {
    if (dev) {
      const ignored = config.watchOptions?.ignored;
      config.watchOptions = {
        ...(config.watchOptions || {}),
        ignored: mergeWatchIgnored(ignored)
      };
    }
    return config;
  }
};

export default nextConfig;
