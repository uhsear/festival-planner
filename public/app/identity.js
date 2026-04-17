/**
 * Identity utilities — avatar rendering, name normalization, profile summaries
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 */

import { S } from './state.js?v=1776342458439';
import { h } from './dom.js?v=1776342458439';
import { getAvatarColor, getInitials, normalizeIdentityName } from './helpers.js?v=1776342458439';

export function normalizeIdentityEntity(entity) {
  if (entity && typeof entity === 'object') {
    const name = entity.username ?? entity.name ?? entity.label ?? '';
    return {
      name: normalizeIdentityName(name),
      avatarUrl: typeof entity.avatarUrl === 'string' && entity.avatarUrl ? entity.avatarUrl : null
    };
  }
  return { name: normalizeIdentityName(entity), avatarUrl: null };
}

export function isCurrentIdentity(entity) {
  return normalizeIdentityEntity(entity).name.toLowerCase() === normalizeIdentityName(S.user?.username).toLowerCase();
}

export function getAvatarMeta(entity) {
  const identity = normalizeIdentityEntity(entity);
  const label = identity.name;
  return {
    name: label,
    color: getAvatarColor(label),
    initials: getInitials(label) || label.slice(0, 2).toUpperCase(),
    isMe: isCurrentIdentity(identity),
    avatarUrl: identity.avatarUrl,
  };
}

export function createAvatar(entity, options = {}) {
  const meta = getAvatarMeta(entity);
  const size = options.size || 24;
  const fontSize = options.fontSize || Math.max(8, Math.round(size * 0.42));
  const classTokens = new Set(String(options.className || '').split(/\s+/).filter(Boolean));
  if (!classTokens.has('avatar') && !classTokens.has('mini-avatar')) classTokens.add('avatar');
  if (meta.isMe) classTokens.add('avatar-self');
  if (options.extraClass) String(options.extraClass).split(/\s+/).filter(Boolean).forEach(token => classTokens.add(token));
  const title = options.title || `${meta.name}${meta.isMe ? ' (You)' : ''}`;
  const el = h(options.tag || 'div', {
    className: [...classTokens].join(' '),
    style: { background: meta.color, width: `${size}px`, height: `${size}px`, fontSize: `${fontSize}px`, ...(options.style || {}) },
    title,
    'aria-label': options.ariaLabel || title,
    role: 'img',
  });
  const setFallback = () => { el.textContent = meta.initials; };
  if (meta.avatarUrl) {
    const img = h('img', { src: meta.avatarUrl, alt: '', loading: options.loading || 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => { img.remove(); setFallback(); }, { once: true });
    el.appendChild(img);
  } else setFallback();
  return el;
}

export function createIdentityBadge(label, extraClass = '') {
  return h('span', { className: `identity-badge${extraClass ? ` ${extraClass}` : ''}` }, label);
}

export function getProfileSummary(profile = S.currentProfile) {
  const picks = profile?.picks || {};
  const notes = profile?.notes || {};
  return {
    must: Object.values(picks).filter(v => v === 'must').length,
    want: Object.values(picks).filter(v => v === 'want-to-see').length,
    maybe: Object.values(picks).filter(v => v === 'maybe').length,
    total: Object.keys(picks).length,
    notes: Object.keys(notes).length,
  };
}

export function getOwnProfile(profiles = S.allProfiles) {
  return S.user?.id ? profiles.find(profile => profile.userId === S.user.id) || null : null;
}

export function updateIdentityCollections(username, avatarUrl, profileId = null) {
  const normalized = normalizeIdentityName(username).toLowerCase();
  if (S.user && normalizeIdentityName(S.user.username).toLowerCase() === normalized) S.user = { ...S.user, avatarUrl };
  if (S.currentProfile && profileId && S.currentProfile.id === profileId) S.currentProfile = { ...S.currentProfile, avatarUrl };
  S.allProfiles = S.allProfiles.map(profile => {
    const matchesProfile = profileId && profile.id === profileId;
    const matchesName = normalizeIdentityName(profile.name).toLowerCase() === normalized;
    return (matchesProfile || matchesName) ? { ...profile, avatarUrl } : profile;
  });
  S.onlineUsers = S.onlineUsers.map(user =>
    normalizeIdentityName(user.username).toLowerCase() === normalized ? { ...user, avatarUrl } : user
  );
}
