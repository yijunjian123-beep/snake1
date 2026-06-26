import { defineConfig, loadEnv } from "vite";

function normalizeBasePath(rawBase: string | undefined, defaultBase: string): string {
  const trimmed = rawBase?.trim() ?? "";

  if (trimmed.length === 0) {
    return defaultBase;
  }

  if (trimmed === "/" || trimmed === "./") {
    return "/";
  }

  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;

  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const repoName = process.env.GITHUB_REPOSITORY?.split("/").pop();
  const defaultBase = process.env.GITHUB_ACTIONS === "true" && repoName ? `/${repoName}/` : "/";

  return {
    base: normalizeBasePath(env.VITE_BASE_PATH, defaultBase),
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
    },
    preview: {
      host: "0.0.0.0",
      port: 4173,
      strictPort: true,
    },
  };
});

