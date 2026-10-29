interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
}

const VERSION_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parses `v1.2.3-rc.1+build` style tags; missing minor/patch are 0. Null for anything else. */
export function parseVersion(value: string): ParsedVersion | null {
  const match = VERSION_RE.exec(value.trim());
  if (!match) return null;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((id) => id === "")) return null;
  return {
    core: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    prerelease,
  };
}

/** Semver precedence of two prerelease identifiers. */
function compareIdentifiers(a: string, b: string): number {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return Number(a) - Number(b);
  if (aNum) return -1; // numeric identifiers sort before alphanumeric ones
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Negative, zero or positive like a sort comparator; null when either version can't be parsed. */
export function compareVersions(a: string, b: string): number | null {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return null;

  for (let i = 0; i < 3; i++) {
    if (va.core[i] !== vb.core[i]) return va.core[i] - vb.core[i];
  }
  // A release is newer than any of its prereleases.
  if (va.prerelease.length === 0 || vb.prerelease.length === 0) {
    return vb.prerelease.length - va.prerelease.length;
  }
  const length = Math.max(va.prerelease.length, vb.prerelease.length);
  for (let i = 0; i < length; i++) {
    // A shorter set of identifiers sorts first when all preceding ones are equal.
    if (va.prerelease[i] === undefined) return -1;
    if (vb.prerelease[i] === undefined) return 1;
    const diff = compareIdentifiers(va.prerelease[i], vb.prerelease[i]);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** True only when `latest` is a strictly newer version than `current`; unparsable input is never newer. */
export function isNewerVersion(latest: string, current: string): boolean {
  const diff = compareVersions(latest, current);
  return diff !== null && diff > 0;
}
