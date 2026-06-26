interface ImportMetaEnvLike {
  readonly VITE_BUILD_VERSION?: string;
}

interface ImportMetaLike {
  readonly env?: ImportMetaEnvLike;
}

function normalizeBuildVersion(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";

  return trimmed.length > 0 ? trimmed : "dev";
}

export function resolveBuildVersion(env?: ImportMetaEnvLike): string {
  const resolvedEnv = env ?? (import.meta as ImportMetaLike).env;

  return normalizeBuildVersion(resolvedEnv?.VITE_BUILD_VERSION);
}

export function formatBuildVersionLabel(buildVersion: string): string {
  const normalized = normalizeBuildVersion(buildVersion);
  const shortVersion = normalized.length > 7 ? normalized.slice(0, 7) : normalized;

  return `build ${shortVersion}`;
}
