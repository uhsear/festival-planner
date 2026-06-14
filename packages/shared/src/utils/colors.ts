const _colorCache = new Map<string, string>();
const _initialsCache = new Map<string, string>();

export function getIdentityHash(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

export function getAvatarColor(name: string): string {
  if (_colorCache.has(name)) {
    const v = _colorCache.get(name)!;
    _colorCache.delete(name);
    _colorCache.set(name, v);
    return v;
  }

  const hash = getIdentityHash(name);
  // Clamp the generated hue out of the brand-accent bands so a random avatar
  // never collides with the aqua primary (~160-205deg) or the coral danger
  // accent (~335-360 / 0-20deg). Allowed span = 268deg across two arcs:
  // [21,159] (139deg) and [206,334] (129deg). Deterministic on the hash.
  const h = hash % 268;
  const hue = h < 139 ? 21 + h : 206 + (h - 139);
  const saturation = 62 + (hash % 12);
  const lightness = 46 + (hash % 10);
  const color = `hsl(${hue} ${saturation}% ${lightness}%)`;
  _colorCache.set(name, color);

  if (_colorCache.size > 200) {
    const firstKey = _colorCache.keys().next().value as string;
    if (firstKey) {
      _colorCache.delete(firstKey);
    }
  }

  return color;
}

export function getInitials(name: string): string {
  if (_initialsCache.has(name)) {
    const v = _initialsCache.get(name)!;
    _initialsCache.delete(name);
    _initialsCache.set(name, v);
    return v;
  }

  const result = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  _initialsCache.set(name, result);

  if (_initialsCache.size > 200) {
    const firstKey = _initialsCache.keys().next().value as string;
    if (firstKey) {
      _initialsCache.delete(firstKey);
    }
  }

  return result;
}

export function normalizeIdentityName(name: string | undefined): string {
  const value = String(name || '').trim();
  return value || 'User';
}
