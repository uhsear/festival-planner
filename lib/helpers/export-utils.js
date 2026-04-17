// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

/**
 * Export generation — HTML rendering, set timing, crew overlap, serialization.
 */

const { escapeHtml } = require('./sanitize');

function getAvatarColor(name) {
  const colors = ['#ff3366', '#00e8d0', '#ffb020', '#39ff14', '#ff8c00', '#4488ff', '#ff4444', '#e040fb', '#00e5ff', '#ffab00'];
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = name.charCodeAt(index) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name) {
  return String(name)
    .split(' ')
    .map((word) => word[0] || '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatTime(value) {
  if (!value) return '';
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  let hour = hours;
  const amPm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, '0')} ${amPm}`;
}


function formatExportTimestamp(value) {
  if (!value) return '';
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return '';
  return stamp.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function timeToMinutes(value) {
  if (!value) return 0;
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  return (hours * 60) + minutes;
}

function buildSetDateStamp(dayDate, timeValue) {
  if (!dayDate || !timeValue) return null;
  const stamp = new Date(`${dayDate}T${timeValue}:00`);
  return Number.isNaN(stamp.getTime()) ? null : stamp;
}

function getSetTiming(set) {
  const start = buildSetDateStamp(set.dayDate, set.startTime);
  let end = buildSetDateStamp(set.dayDate, set.endTime);
  if (start && end && end <= start) end = new Date(end.getTime() + (24 * 60 * 60 * 1000));
  return { start, end };
}

function buildFestivalSetList(festival) {
  return (festival.days || [])
    .flatMap((day, dayIndex) => (day.sets || []).map((set) => ({
      ...set,
      dayIndex,
      dayLabel: day.label || day.date || 'Day',
      dayDate: day.date || '',
    })))
    .sort((left, right) => {
      if (left.dayIndex !== right.dayIndex) return left.dayIndex - right.dayIndex;
      const lT = left.startTime || '';
      const rT = right.startTime || '';
      if (lT && rT) return lT.localeCompare(rT) || left.artist.localeCompare(right.artist);
      if (lT && !rT) return -1;
      if (!lT && rT) return 1;
      return left.artist.localeCompare(right.artist);
    });
}

function pickTimedFestivalSet(items, exportedAt) {
  if (items.length === 0) return null;
  const exportedTime = new Date(exportedAt);
  if (Number.isNaN(exportedTime.getTime())) return items[0];

  const current = items.find((entry) => {
    const { start, end } = getSetTiming(entry);
    return start && end && start <= exportedTime && exportedTime < end;
  });
  if (current) return { mode: 'Live now', set: current };

  const next = items.find((entry) => {
    const { end } = getSetTiming(entry);
    return !end || end > exportedTime;
  });
  if (next) return { mode: 'Next move', set: next };

  return { mode: 'Next move', set: items[0] };
}

function getExportPickLabel(priority) {
  return {
    must: 'Must See',
    'want-to-see': 'Want to See',
    maybe: 'Maybe',
  }[priority] || 'Saved';
}

function getExportPickChipClass(priority) {
  return {
    must: 'chip-must',
    'want-to-see': 'chip-want',
    maybe: 'chip-maybe',
  }[priority] || 'chip-accent';
}

function formatSetRangeLabel(set) {
  if (!set.startTime) return `${set.dayLabel} · TBA`;
  const timeLabel = set.endTime
    ? `${formatTime(set.startTime)} - ${formatTime(set.endTime)}`
    : formatTime(set.startTime);
  return `${set.dayLabel} · ${timeLabel}`;
}

function formatSetLocationLabel(set, stageMap) {
  const stage = stageMap.get(set.stageId) || { name: 'Unknown' };
  return `${formatSetRangeLabel(set)} · ${stage.name}`;
}

function getExportCurrentOrNextPickedSet(sets, profile, exportedAt) {
  const picked = sets.filter((set) => profile.picks?.[set.id]);
  return pickTimedFestivalSet(picked, exportedAt);
}

function getExportReminderItems(sets, profile) {
  return sets
    .map((set) => ({
      set,
      lead: Number(profile.reminders?.[set.id] || 0) || 0,
      startsAt: buildSetDateStamp(set.dayDate, set.startTime),
    }))
    .filter((entry) => entry.lead > 0)
    .sort((left, right) => (
      (left.startsAt?.getTime() || Number.MAX_SAFE_INTEGER)
      - (right.startsAt?.getTime() || Number.MAX_SAFE_INTEGER)
    ));
}

function formatCrewOverlapLabel(names) {
  if (names.length === 0) return 'No shared set yet';
  if (names.length === 1) return `${names[0]} also saved this`;
  if (names.length === 2) return `${names[0]} and ${names[1]} also saved this`;
  return `${names[0]} + ${names.length - 1} others also saved this`;
}

function getExportNextCrewOverlap(sets, profile, allProfiles, exportedAt) {
  const overlapEntries = sets
    .map((set) => {
      if (!profile.picks?.[set.id]) return null;
      const others = allProfiles
        .filter((otherProfile) => otherProfile.id !== profile.id && otherProfile.picks?.[set.id])
        .map((otherProfile) => otherProfile.name);
      if (others.length === 0) return null;
      return { ...set, otherNames: others };
    })
    .filter(Boolean);

  const choice = pickTimedFestivalSet(overlapEntries, exportedAt);
  if (!choice) return null;
  return {
    mode: choice.mode,
    set: choice.set,
    otherNames: choice.set.otherNames,
  };
}


function buildAvatarUrl(user) {
  if (!user?.avatarKey || !user?.avatarVersion) return null;
  return `/uploads/avatars/${user.avatarKey}.webp?v=${encodeURIComponent(user.avatarVersion)}`;
}



function serializeOwnProfile(profile, user = null) {
  return {
    id: profile.id,
    festivalId: profile.festivalId,
    userId: profile.userId,
    name: profile.name,
    avatarUrl: buildAvatarUrl(user),
    picks: profile.picks || {},
    notes: profile.notes || {},
    reminders: profile.reminders || {},
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function serializeProfileForViewer(profile, viewerUserId, user = null) {
  const result = {
    id: profile.id,
    festivalId: profile.festivalId,
    name: profile.name,
    avatarUrl: buildAvatarUrl(user),
    picks: profile.picks || {},
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    userId: profile.userId,
  };

  if (profile.userId === viewerUserId) {
    result.notes = profile.notes || {};
    result.reminders = profile.reminders || {};
  }

  return result;
}

function buildExportHtml(template, festival, profile, allProfiles, exportedAt) {
  const stageMap = new Map((festival.stages || []).map((stage) => [stage.id, stage]));
  const sets = buildFestivalSetList(festival);
  const reminders = getExportReminderItems(sets, profile);
  const reminderMap = new Map(reminders.map((entry) => [entry.set.id, entry.lead]));
  const nextMove = getExportCurrentOrNextPickedSet(sets, profile, exportedAt);
  const crewOverlap = getExportNextCrewOverlap(sets, profile, allProfiles, exportedAt);
  const picks = profile.picks || {};
  const notes = profile.notes || {};
  const overviewMarkup = `<div class="overview-grid">
    <div class="overview-card"><span class="overview-label">Total picks</span><strong>${escapeHtml(String(Object.keys(picks).length))}</strong><div class="overview-meta">${escapeHtml(`${festival.days?.length || 0} festival days loaded`)}</div></div>
    <div class="overview-card"><span class="overview-label">Must see</span><strong>${escapeHtml(String(Object.values(picks).filter((value) => value === 'must').length))}</strong><div class="overview-meta">Highest-priority saves</div></div>
    <div class="overview-card"><span class="overview-label">Private notes</span><strong>${escapeHtml(String(Object.keys(notes).length))}</strong><div class="overview-meta">Only included in your export</div></div>
    <div class="overview-card"><span class="overview-label">Reminders</span><strong>${escapeHtml(String(reminders.length))}</strong><div class="overview-meta">Timed alerts on this device</div></div>
  </div>`;

  const nextMoveMarkup = nextMove?.set
    ? `<div class="snapshot-card"><span class="snapshot-kicker">${escapeHtml(nextMove.mode)}</span><h3>${escapeHtml(nextMove.set.artist)}</h3><p>${escapeHtml(formatSetLocationLabel(nextMove.set, stageMap))}</p><div class="snapshot-chips"><span class="chip ${escapeHtml(getExportPickChipClass(picks[nextMove.set.id]))}">${escapeHtml(getExportPickLabel(picks[nextMove.set.id]))}</span>${reminderMap.has(nextMove.set.id) ? `<span class="chip chip-reminder">${escapeHtml(`${reminderMap.get(nextMove.set.id)}m reminder`)}</span>` : ''}</div></div>`
    : '<div class="snapshot-card"><span class="snapshot-kicker">Next move</span><h3>Nothing lined up yet</h3><p>Save a few sets in Festie and your next move will appear here.</p></div>';

  const overlapMarkup = crewOverlap?.set
    ? `<div class="snapshot-card"><span class="snapshot-kicker">Crew overlap</span><h3>${escapeHtml(crewOverlap.set.artist)}</h3><p>${escapeHtml(`${formatCrewOverlapLabel(crewOverlap.otherNames)} · ${formatSetLocationLabel(crewOverlap.set, stageMap)}`)}</p><div class="snapshot-meta">${escapeHtml(crewOverlap.mode)}</div></div>`
    : '<div class="snapshot-card"><span class="snapshot-kicker">Crew overlap</span><h3>No shared set yet</h3><p>When your crew saves the same set, the next overlap will show up here.</p></div>';

  const liveMarkup = `<section class="section"><div class="section-title"><div class="dot" style="background:${escapeHtml('#39ff14')}"></div>Live Snapshot</div><div class="snapshot-grid">${nextMoveMarkup}${overlapMarkup}</div></section>`;

  const remindersMarkup = reminders.length > 0
    ? `<section class="section"><div class="section-title"><div class="dot" style="background:${escapeHtml('#ffb020')}"></div>Upcoming Reminders</div><div class="reminder-list">${reminders.slice(0, 4).map((entry) => `<div class="reminder-item"><div class="reminder-copy"><strong>${escapeHtml(entry.set.artist)}</strong><span>${escapeHtml(formatSetLocationLabel(entry.set, stageMap))}</span></div><span class="chip chip-reminder">${escapeHtml(`${entry.lead}m alert`)}</span></div>`).join('')}</div></section>`
    : '';

  const categories = [
    ['must', 'Must See', '#ff3366'],
    ['want-to-see', 'Want to See', '#00e8d0'],
    ['maybe', 'Maybe', '#ffb020'],
  ];

  const sections = categories
    .map(([priority, label, color]) => {
      const items = sets
        .filter((set) => profile.picks?.[set.id] === priority)
        .sort((left, right) => `${left.dayLabel}${left.startTime}`.localeCompare(`${right.dayLabel}${right.startTime}`));

      if (items.length === 0) return '';

      const rows = items
        .map((set) => {
          const stage = stageMap.get(set.stageId) || { name: 'Unknown', color: '#666666' };
          const others = allProfiles.filter((otherProfile) => otherProfile.id !== profile.id && otherProfile.picks?.[set.id]);
          const friendMarkup = others.length > 0
            ? `<span class="friends">${others
                .map((otherProfile) => {
                  const colorValue = getAvatarColor(otherProfile.name);
                  const initials = getInitials(otherProfile.name);
                  return `<span class="mini-avatar" style="background:${escapeHtml(colorValue)}" title="${escapeHtml(otherProfile.name)}">${escapeHtml(initials)}</span>`;
                })
                .join('')}</span>`
            : '<span class="solo">Solo</span>';
          const note = profile.notes?.[set.id]
            ? `<div class="note">&#128221; ${escapeHtml(profile.notes[set.id])}</div>`
            : '';
          const reminderChip = reminderMap.has(set.id)
            ? `<span class="chip chip-reminder">${escapeHtml(`${reminderMap.get(set.id)}m alert`)}</span>`
            : '';

          return `<div class="set-row"><span class="time">${escapeHtml(formatSetRangeLabel(set))}</span><span class="artist">${escapeHtml(set.artist)}</span><span class="stage" style="background:${escapeHtml(stage.color)}25;color:${escapeHtml(stage.color)}">${escapeHtml(stage.name)}</span>${reminderChip ? `<span class="set-badges">${reminderChip}</span>` : ''}${friendMarkup}</div>${note}`;
        })
        .join('');

      return `<section class="section"><div class="section-title"><div class="dot" style="background:${escapeHtml(color)}"></div>${escapeHtml(label)} (${items.length})</div>${rows}</section>`;
    })
    .join('');

  const content = sections || '<div class="empty-state"><div class="empty-icon">&#127914;</div><p>No sets picked yet.</p></div>';

  const crewMembers = allProfiles.filter((p) => p.id !== profile.id && Object.keys(p.picks || {}).length > 0);
  let crewMarkup = '';
  if (crewMembers.length > 0) {
    const crewRows = crewMembers.map((member) => {
      const memberPicks = member.picks || {};
      const memberSets = sets
        .filter((s) => memberPicks[s.id])
        .sort((a, b) => `${a.dayLabel}${a.startTime}`.localeCompare(`${b.dayLabel}${b.startTime}`));
      const myPicks = profile.picks || {};
      const shared = memberSets.filter((s) => myPicks[s.id]).length;
      const colorValue = getAvatarColor(member.name);
      const initials = getInitials(member.name);

      const setRows = memberSets.map((set) => {
        const stage = stageMap.get(set.stageId) || { name: 'Unknown', color: '#666666' };
        const pri = memberPicks[set.id];
        const priClass = pri === 'must' ? 'chip-must' : pri === 'want-to-see' ? 'chip-want' : 'chip-maybe';
        const priLabel = pri === 'must' ? 'Must' : pri === 'want-to-see' ? 'Want' : 'Maybe';
        const overlap = myPicks[set.id] ? ' 🤝' : '';
        return `<div class="set-row"><span class="time">${escapeHtml(formatSetRangeLabel(set))}</span><span class="artist">${escapeHtml(set.artist)}${overlap}</span><span class="stage" style="background:${escapeHtml(stage.color)}25;color:${escapeHtml(stage.color)}">${escapeHtml(stage.name)}</span><span class="chip ${priClass}">${escapeHtml(priLabel)}</span></div>`;
      }).join('');

      return `<div class="crew-member-section"><div class="crew-member-header"><span class="mini-avatar" style="background:${escapeHtml(colorValue)}">${escapeHtml(initials)}</span><strong>${escapeHtml(member.name)}</strong><span class="crew-meta">${memberSets.length} picks &middot; ${shared} shared</span></div>${setRows}</div>`;
    }).join('');

    crewMarkup = `<section class="section"><div class="section-title"><div class="dot" style="background:#a78bfa"></div>Crew Schedules (${crewMembers.length})</div>${crewRows}</section>`;
  }

  return template
    .replace(/__TITLE__/g, escapeHtml(festival.name))
    .replace(/__SUBTITLE__/g, escapeHtml(`${profile.name}'s Schedule${festival.location ? ` - ${festival.location}` : ''}`))
    .replace(/__OVERVIEW__/g, overviewMarkup)
    .replace(/__LIVE__/g, liveMarkup)
    .replace(/__REMINDERS__/g, remindersMarkup)
    .replace(/__SECTIONS__/g, content + crewMarkup)
    .replace(/__EXPORTED_AT__/g, escapeHtml(new Date(exportedAt).toLocaleString()));
}

function serializeExportCrewProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    picks: profile.picks || {},
  };
}


module.exports = {
  getAvatarColor, getInitials, formatTime, formatExportTimestamp,
  timeToMinutes, buildSetDateStamp, getSetTiming, buildFestivalSetList,
  pickTimedFestivalSet, getExportPickLabel, getExportPickChipClass,
  formatSetRangeLabel, formatSetLocationLabel,
  getExportCurrentOrNextPickedSet, getExportReminderItems,
  formatCrewOverlapLabel, getExportNextCrewOverlap,
  buildAvatarUrl, serializeOwnProfile, serializeProfileForViewer,
  buildExportHtml, serializeExportCrewProfile,
};
