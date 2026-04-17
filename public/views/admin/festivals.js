/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */

/**
 * Admin festivals — list, editor, CSV/JSON import/export, CRUD
 */

import { S, adminState, MAX_IMPORT_TEXT_LENGTH } from '../../app/state.js?v=1776342458439';
import { $, createClientOpaqueId, h } from '../../app/dom.js?v=1776342458439';

// ── CSV / JSON utilities ───────────────────────────────────────

function downloadTextFile(filename, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(value) {
  const text = String(value ?? '');
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function festivalToCsv(festival) {
  const rows = [['dayLabel', 'date', 'artist', 'stage', 'startTime', 'endTime', 'stageColor', 'artists_json']];
  const stageMap = new Map((festival.stages || []).map(stage => [stage.id, stage]));
  (festival.days || []).forEach(day =>
    (day.sets || []).forEach(set => {
      const stage = stageMap.get(set.stageId) || {};
      rows.push([
        day.label || '', day.date || '', set.artist || '', stage.name || '',
        set.startTime || '', set.endTime || '', stage.color || '',
        set.artists?.length > 0 ? JSON.stringify(set.artists) : '',
      ]);
    })
  );
  return rows.map(row => row.map(csvEscape).join(',')).join('\n');
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"') {
      if (quoted && next === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) { values.push(current); current = ''; continue; }
    current += char;
  }
  values.push(current);
  return values;
}

function slugifyStageName(name) {
  return (
    String(name || 'stage').trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'stage'
  );
}

function festivalFromCsv(csv, baseFestival = {}) {
  const raw = String(csv || '');
  if (raw.length > MAX_IMPORT_TEXT_LENGTH) throw new Error('Import file is too large');
  const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV must include a header and at least one set row');
  const header = parseCsvLine(lines.shift()).map(value => value.trim());
  const required = ['dayLabel', 'date', 'artist', 'stage'];
  required.forEach(column => {
    if (!header.includes(column)) throw new Error(`CSV is missing the "${column}" column`);
  });
  const indexes = Object.fromEntries(header.map((column, index) => [column, index]));
  const stages = [];
  const stageMap = new Map();
  const dayMap = new Map();
  lines.forEach((line) => {
    const values = parseCsvLine(line);
    const artist = (values[indexes.artist] || '').trim();
    if (!artist) return;
    const stageName = (values[indexes.stage] || '').trim() || 'Stage';
    const stageColor = (values[indexes.stageColor] || '').trim() || '#6a6a88';
    let stage = stageMap.get(stageName.toLowerCase());
    if (!stage) {
      stage = { id: createClientOpaqueId(`stage-${slugifyStageName(stageName)}`), name: stageName, color: stageColor };
      stageMap.set(stageName.toLowerCase(), stage);
      stages.push(stage);
    }
    const dayLabel = (values[indexes.dayLabel] || '').trim() || `Day ${stages.length}`;
    const date = (values[indexes.date] || '').trim();
    const dayKey = `${dayLabel}__${date}`;
    if (!dayMap.has(dayKey)) dayMap.set(dayKey, { label: dayLabel, date, sets: [] });
    // Parse artists_json if present for round-trip fidelity
    let artists;
    const artistsJsonRaw = indexes.artists_json !== undefined ? (values[indexes.artists_json] || '').trim() : '';
    if (artistsJsonRaw) {
      try { artists = JSON.parse(artistsJsonRaw); } catch { artists = null; }
    }
    if (!artists) artists = [{ name: artist, links: {} }];
    dayMap.get(dayKey).sets.push({
      id: createClientOpaqueId('set'), artist, artists, stageId: stage.id,
      startTime: (values[indexes.startTime] || '').trim(),
      endTime: (values[indexes.endTime] || '').trim(),
    });
  });
  return { name: baseFestival.name || 'Imported Festival', location: baseFestival.location || '', stages, days: [...dayMap.values()] };
}

function collectFestivalEditorWarnings(fest) {
  const warnings = [];
  const stageNameCounts = new Map();
  (fest.stages || []).forEach(stage => {
    const key = String(stage.name || '').trim().toLowerCase();
    if (!key) return;
    stageNameCounts.set(key, (stageNameCounts.get(key) || 0) + 1);
  });
  for (const [key, count] of stageNameCounts.entries())
    if (count > 1) warnings.push(`Duplicate stage name: ${key}`);
  (fest.days || []).forEach(day => {
    const byStage = new Map();
    (day.sets || []).forEach(set => {
      const list = byStage.get(set.stageId) || [];
      list.push(set);
      byStage.set(set.stageId, list);
    });
    for (const sets of byStage.values()) {
      const withTimes = sets.filter(s => s.startTime && s.endTime);
      const sorted = [...withTimes].sort((left, right) => String(left.startTime).localeCompare(String(right.startTime)));
      for (let index = 1; index < sorted.length; index += 1) {
        if (sorted[index].startTime < sorted[index - 1].endTime)
          warnings.push(`Overlap on ${day.label || day.date || 'day'}: ${sorted[index - 1].artist || sorted[index - 1].artists?.[0]?.name || 'Unnamed'} and ${sorted[index].artist || sorted[index].artists?.[0]?.name || 'Unnamed'}`);
      }
    }
  });
  return warnings;
}

// ── Import modal ───────────────────────────────────────────────

function showFestivalImportModal(format, deps) {
  const { toast, rerender } = deps;
  const overlay = h('div', { className: 'import-overlay' });
  const box = h('div', { className: 'import-box' });
  box.appendChild(h('h3', {}, format === 'json' ? 'IMPORT FESTIVAL JSON' : 'IMPORT LINEUP CSV'));
  box.appendChild(h('p', {},
    format === 'json'
      ? 'Paste a festival JSON document or load a file. The editor will populate so you can review before saving.'
      : 'Use columns ',
    h('code', {}, 'dayLabel,date,artist,stage,startTime,endTime,stageColor'),
    '. The parsed lineup loads into the editor first.'
  ));
  const textarea = h('textarea', { placeholder: format === 'json' ? 'Paste festival JSON here' : 'Paste lineup CSV here' });
  box.appendChild(textarea);
  const fileInput = h('input', { type: 'file', accept: format === 'json' ? '.json,application/json' : '.csv,text/csv', style: { display: 'none' } });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_TEXT_LENGTH) { toast('Import file is too large', 'error'); fileInput.value = ''; return; }
    file.text().then(text => { textarea.value = text; });
  });
  box.appendChild(fileInput);
  const buttonRow = h('div', { className: 'btn-row' });
  buttonRow.appendChild(h('button', { className: 'btn btn-ghost', type: 'button', onclick: () => fileInput.click() }, 'Load File'));
  buttonRow.appendChild(h('button', { className: 'btn btn-ghost', type: 'button', onclick: () => overlay.remove() }, 'Cancel'));
  buttonRow.appendChild(h('button', {
    className: 'btn btn-primary', type: 'button',
    onclick: () => {
      try {
        if ((textarea.value || '').length > MAX_IMPORT_TEXT_LENGTH) throw new Error('Import file is too large');
        const baseFestival = adminState.editFestival?.id ? adminState.editFestival : {};
        const nextFestival = format === 'json' ? JSON.parse(textarea.value || '{}') : festivalFromCsv(textarea.value || '', baseFestival);
        adminState.editFestival = { ...(baseFestival || {}), ...nextFestival, id: baseFestival.id || nextFestival.id };
        adminState.tab = 'create';
        overlay.remove();
        rerender();
        toast(format === 'json' ? 'Festival JSON loaded' : 'Lineup CSV loaded', 'success');
      } catch (e) { toast(e.message || 'Import failed', 'error'); }
    },
  }, 'Import'));
  box.appendChild(buttonRow);
  overlay.appendChild(box);
  overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// ── CRUD helpers ───────────────────────────────────────────────

async function cloneFestivalForAdmin(festivalId, deps) {
  const { api, adminApi, toast, render, rerender } = deps;
  try {
    await adminApi('/admin/festivals/' + festivalId + '/clone', { method: 'POST' });
    S.festivals = await api('/festivals');
    toast('Festival cloned', 'success');
    rerender();
    render();
  } catch (e) { toast(e.message || 'Clone failed', 'error'); }
}

async function exportFestivalForAdmin(festivalId, format, deps) {
  const { api, toast } = deps;
  try {
    const festival = await api('/festivals/' + festivalId);
    if (format === 'json')
      downloadTextFile(`${festival.name.replace(/[^a-z0-9_-]/gi, '_') || 'festival'}.json`, JSON.stringify(festival, null, 2), 'application/json');
    else
      downloadTextFile(`${festival.name.replace(/[^a-z0-9_-]/gi, '_') || 'festival'}_lineup.csv`, festivalToCsv(festival), 'text/csv;charset=utf-8');
  } catch (e) { toast(e.message || 'Export failed', 'error'); }
}

// ── Festival list tab ──────────────────────────────────────────

export function renderAdminFestivalList(panel, deps) {
  const { api, adminApi, toast, render, styledConfirm, rerender } = deps;
  panel.appendChild(
    h('div', { className: 'admin-toolbar', role: 'region', 'aria-label': 'Festival management' },
      h('button', { className: 'btn btn-primary btn-sm', onclick: () => { adminState.editFestival = null; adminState.tab = 'create'; rerender(); } }, '+ Create Festival'),
      h('button', { className: 'btn btn-ghost btn-sm', onclick: () => showFestivalImportModal('json', deps) }, 'Import JSON'),
      h('button', { className: 'btn btn-ghost btn-sm', onclick: () => showFestivalImportModal('csv', deps) }, 'Import CSV'),
    )
  );
  panel.appendChild(h('div', { className: 'admin-import-help' }, 'Clone an existing festival, or load JSON/CSV into the editor and review before saving.'));

  S.festivals.forEach(f => {
    const dayCount = (f.days || []).length;
    const setCount = (f.days || []).reduce((sum, d) => sum + (d.sets || []).length, 0);
    const dates = (f.days || []).filter(d => d.date).map(d => d.date).sort();
    const dateRange = dates.length > 1
      ? `${new Date(dates[0] + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(dates[dates.length - 1] + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      : dates.length === 1
        ? new Date(dates[0] + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '';

    const row = h('div', {
      className: 'flex items-center justify-between',
      'data-testid': 'admin-festival-row',
      'data-festival-id': f.id,
      style: { padding: '12px', background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)', marginBottom: '8px', border: '1px solid var(--border)' },
    });
    row.appendChild(h('div', {},
      h('div', { style: { fontWeight: '700', fontSize: '15px' } }, f.name),
      h('div', { style: { fontSize: '12px', color: 'var(--text-secondary)' } }, [f.location, dateRange].filter(Boolean).join(' · ')),
      h('div', { style: { fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' } }, `${dayCount} day${dayCount !== 1 ? 's' : ''} · ${setCount} set${setCount !== 1 ? 's' : ''}`),
    ));
    const btns = h('div', { className: 'flex gap-2' });
    btns.appendChild(h('button', { className: 'btn btn-ghost btn-sm', 'data-testid': 'admin-clone-festival', onclick: () => cloneFestivalForAdmin(f.id, deps) }, 'Clone'));
    btns.appendChild(h('button', { className: 'btn btn-ghost btn-sm mobile-hide', onclick: () => exportFestivalForAdmin(f.id, 'json', deps) }, 'JSON'));
    btns.appendChild(h('button', { className: 'btn btn-ghost btn-sm mobile-hide', onclick: () => exportFestivalForAdmin(f.id, 'csv', deps) }, 'CSV'));
    btns.appendChild(h('button', {
      className: 'btn btn-ghost btn-sm', 'data-testid': 'admin-edit-festival',
      onclick: async () => {
        try { adminState.editFestival = await api('/festivals/' + f.id); adminState.tab = 'create'; rerender(); }
        catch (e) { toast('Failed to load', 'error'); }
      },
    }, 'Edit'));
    btns.appendChild(h('button', {
      className: 'btn btn-danger btn-sm', 'data-testid': 'admin-delete-festival',
      onclick: async () => {
        const confirmed = await styledConfirm(`Delete "${f.name}"? This cannot be undone.`, { confirmLabel: 'Delete Festival', confirmClass: 'btn btn-danger' });
        if (!confirmed) return;
        try {
          await adminApi('/festivals/' + f.id, { method: 'DELETE' });
          S.festivals = await api('/festivals');
          if (S.currentFestival?.id === f.id) S.currentFestival = null;
          toast('Festival deleted', 'success');
          render();
          rerender();
        } catch (e) { toast('Failed: ' + e.message, 'error'); }
      },
    }, 'Delete'));
    row.appendChild(btns);
    panel.appendChild(row);
  });

  if (S.festivals.length === 0)
    panel.appendChild(h('p', { style: { color: 'var(--text-muted)', textAlign: 'center', padding: '20px' } }, 'No festivals yet. Create one!'));
}

// ── Festival editor tab ────────────────────────────────────────

export function renderAdminFestivalEditor(panel, deps) {
  const { api, adminApi, toast, render, styledConfirm, harvestEditorFields, rerender } = deps;
  const fest = adminState.editFestival || { name: '', location: '', stages: [], days: [] };
  const isEdit = !!adminState.editFestival?.id;
  const warnings = collectFestivalEditorWarnings(fest);

  panel.appendChild(h('div', { className: 'admin-toolbar' },
    h('button', { className: 'btn btn-ghost btn-sm', onclick: () => showFestivalImportModal('json', deps) }, 'Import JSON'),
    h('button', { className: 'btn btn-ghost btn-sm', onclick: () => showFestivalImportModal('csv', deps) }, 'Import CSV'),
    isEdit ? h('button', { className: 'btn btn-ghost btn-sm mobile-hide', onclick: () => exportFestivalForAdmin(fest.id, 'json', deps) }, 'Export JSON') : null,
    isEdit ? h('button', { className: 'btn btn-ghost btn-sm mobile-hide', onclick: () => exportFestivalForAdmin(fest.id, 'csv', deps) }, 'Export CSV') : null,
  ));

  if (warnings.length > 0) {
    const warningBox = h('div', { className: 'detail-conflict-warning', style: { marginBottom: '20px' } });
    warningBox.appendChild(h('strong', {}, 'Review these lineup warnings before saving: '));
    warningBox.appendChild(h('span', {}, warnings.join(' · ')));
    panel.appendChild(warningBox);
  }

  panel.appendChild(h('div', { className: 'form-group' },
    h('label', {}, 'Festival Name'),
    h('input', { type: 'text', id: 'adminFestName', value: fest.name, placeholder: 'e.g., Forbidden Kingdom 2025' })
  ));
  panel.appendChild(h('div', { className: 'form-group' },
    h('label', {}, 'Location'),
    h('input', { type: 'text', id: 'adminFestLocation', value: fest.location || '', placeholder: 'e.g., Orlando Amphitheater' })
  ));
  panel.appendChild(h('div', { className: 'form-group' },
    h('label', {}, 'B2B Separator'),
    h('input', { type: 'text', id: 'adminFestB2bSeparator', value: fest.b2bSeparator || fest.b2bseparator || '', placeholder: 'b2b (default)', style: { width: '120px' } }),
    h('span', { style: { fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' } }, 'Displayed between artist names for back-to-back sets'),
  ));

  // Stages
  panel.appendChild(h('h3', { style: { fontSize: '16px', fontWeight: '700', margin: '20px 0 10px', color: 'var(--accent-aqua)' } }, 'Stages'));
  const sc = h('div', { id: 'adminStages' });
  (fest.stages || []).forEach((stage, i) => {
    const row = h('div', { className: 'admin-stage-row' });
    row.appendChild(h('input', { type: 'text', 'data-field': 'name', value: stage.name, placeholder: 'Stage name' }));
    row.appendChild(h('input', { type: 'color', 'data-field': 'color', value: stage.color || '#ff3366', style: { height: '32px', padding: '2px', cursor: 'pointer' } }));
    row.appendChild(h('button', { className: 'btn-delete', onclick: () => { harvestEditorFields(fest); fest.stages.splice(i, 1); adminState.editFestival = fest; rerender(); } }, '×'));
    sc.appendChild(row);
  });
  panel.appendChild(sc);
  panel.appendChild(h('button', {
    className: 'btn btn-ghost btn-sm mt-2',
    onclick: () => {
      harvestEditorFields(fest);
      fest.stages = fest.stages || [];
      fest.stages.push({ id: createClientOpaqueId('stage'), name: '', color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0') });
      adminState.editFestival = fest;
      rerender();
    },
  }, '+ Add Stage'));

  // Days & Sets
  panel.appendChild(h('h3', { style: { fontSize: '16px', fontWeight: '700', margin: '20px 0 10px', color: 'var(--accent-aqua)' } }, 'Days & Sets'));
  const dc = h('div', { id: 'adminDays' });
  (fest.days || []).forEach((day, di) => {
    const dd = h('div', { style: { marginBottom: '20px', padding: '16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' } });
    const dh = h('div', { className: 'flex items-center justify-between mb-2' });
    dh.appendChild(h('div', { className: 'flex gap-2 items-center' },
      h('input', { type: 'text', 'data-dayfield': 'label', value: day.label || '', 'data-dayindex': String(di), placeholder: 'e.g., Friday May 30', style: { width: '200px', fontWeight: '700' } }),
      h('input', { type: 'date', 'data-dayfield': 'date', value: day.date || '', 'data-dayindex': String(di), style: { width: '160px' } }),
    ));
    const dayBtns = h('div', { className: 'flex gap-2' });
    dayBtns.appendChild(h('button', { className: 'btn btn-ghost btn-sm', title: 'Duplicate this day', onclick: () => {
      harvestEditorFields(fest);
      const copy = JSON.parse(JSON.stringify(day));
      copy.label = (copy.label || 'Day') + ' (copy)';
      copy.sets = (copy.sets || []).map(s => ({ ...s, id: createClientOpaqueId('set') }));
      fest.days.splice(di + 1, 0, copy);
      adminState.editFestival = fest;
      rerender();
    } }, 'Dupe Day'));
    dayBtns.appendChild(h('button', { className: 'btn btn-danger btn-sm', onclick: async () => {
      const confirmed = await styledConfirm(`Remove "${day.label || 'this day'}" and all its sets?`, { confirmLabel: 'Remove', confirmClass: 'btn btn-danger' });
      if (!confirmed) return;
      harvestEditorFields(fest);
      fest.days.splice(di, 1);
      adminState.editFestival = fest;
      rerender();
    } }, 'Remove Day'));
    dh.appendChild(dayBtns);
    dd.appendChild(dh);

    // Set header
    const sh = h('div', { className: 'admin-set-row', style: { fontWeight: '700', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', borderBottom: '2px solid var(--border)' } });
    ['Artists', 'Stage', 'Start', 'End', ''].forEach(t => sh.appendChild(h('div', {}, t)));
    dd.appendChild(sh);

    const sd = h('div', { className: 'admin-sets-list' });
    const sortedSets = [...(day.sets || [])].map((set, origIdx) => ({ ...set, _origIdx: origIdx }));
    sortedSets.sort((a, b) => {
      const aHasTime = !!(a.startTime && a.startTime !== '');
      const bHasTime = !!(b.startTime && b.startTime !== '');
      if (aHasTime && !bHasTime) return -1;
      if (!aHasTime && bHasTime) return 1;
      if (aHasTime && bHasTime) return a.startTime.localeCompare(b.startTime);
      const aName = a.artists?.[0]?.name || a.artist || '';
      const bName = b.artists?.[0]?.name || b.artist || '';
      return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
    });
    sortedSets.forEach((set) => {
      const si = set._origIdx;
      const setBlock = h('div', { className: 'admin-set-block', style: { marginBottom: '8px', padding: '8px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' } });
      // Main row: first artist + stage + times + delete
      const mainRow = h('div', { className: 'admin-set-row admin-set-row-5', style: { gap: '6px' } });
      // Ensure artists array exists
      if (!set.artists?.length) set.artists = [{ name: set.artist || '', links: set.linkUrl ? { spotify: set.linkUrl } : {} }];
      mainRow.appendChild(h('input', { type: 'text', value: set.artists[0]?.name || '', 'data-setfield': 'artists[0].name', 'data-di': String(di), 'data-si': String(si), placeholder: 'Artist name' }));
      const ss = h('select', { 'data-setfield': 'stageId', 'data-di': String(di), 'data-si': String(si) });
      (fest.stages || []).forEach(st => {
        const opt = h('option', { value: st.id }, st.name || st.id);
        if (set.stageId === st.id) opt.selected = true;
        ss.appendChild(opt);
      });
      mainRow.appendChild(ss);
      mainRow.appendChild(h('input', { type: 'time', value: set.startTime || '', 'data-setfield': 'startTime', 'data-di': String(di), 'data-si': String(si) }));
      mainRow.appendChild(h('input', { type: 'time', value: set.endTime || '', 'data-setfield': 'endTime', 'data-di': String(di), 'data-si': String(si) }));
      mainRow.appendChild(h('button', { className: 'btn-delete', onclick: () => { harvestEditorFields(fest); day.sets.splice(si, 1); adminState.editFestival = fest; rerender(); } }, '×'));
      setBlock.appendChild(mainRow);
      // Additional artists (for B2B)
      for (let ai = 1; ai < (set.artists || []).length; ai++) {
        const artistRow = h('div', { style: { display: 'flex', gap: '6px', marginTop: '4px', paddingLeft: '4px' } });
        artistRow.appendChild(h('span', { style: { fontSize: '11px', color: 'var(--text-muted)', alignSelf: 'center' } }, (fest.b2bSeparator || 'b2b').toUpperCase()));
        artistRow.appendChild(h('input', { type: 'text', value: set.artists[ai]?.name || '', 'data-setfield': `artists[${ai}].name`, 'data-di': String(di), 'data-si': String(si), placeholder: 'Artist name', style: { flex: '1' } }));
        const removeArtistIdx = ai;
        artistRow.appendChild(h('button', { className: 'btn-delete', style: { fontSize: '11px' }, onclick: () => { harvestEditorFields(fest); set.artists.splice(removeArtistIdx, 1); set.artist = set.artists.map(a => a.name).join(` ${fest.b2bSeparator || 'b2b'} `); adminState.editFestival = fest; rerender(); } }, '×'));
        setBlock.appendChild(artistRow);
      }
      // Links per artist
      (set.artists || []).forEach((a, ai) => {
        const links = a.links || {};
        if (Object.keys(links).length > 0 || set.artists.length > 1) {
          Object.entries(links).forEach(([platform, url]) => {
            const linkRow = h('div', { style: { display: 'flex', gap: '6px', marginTop: '2px', paddingLeft: '20px' } });
            linkRow.appendChild(h('span', { style: { fontSize: '10px', color: 'var(--accent-aqua)', minWidth: '60px', alignSelf: 'center' } }, (a.name || 'Artist ' + (ai + 1)).slice(0, 15) + ' →'));
            linkRow.appendChild(h('select', { 'data-setfield': `artists[${ai}].links._platform_${platform}`, 'data-di': String(di), 'data-si': String(si), style: { width: '90px', fontSize: '11px' } },
              ...['spotify', 'soundcloud', 'instagram', 'twitter', 'tiktok', 'website'].map(p => {
                const opt = h('option', { value: p }, p); if (p === platform) opt.selected = true; return opt;
              })
            ));
            linkRow.appendChild(h('input', { type: 'url', value: url || '', 'data-setfield': `artists[${ai}].links.${platform}`, 'data-di': String(di), 'data-si': String(si), placeholder: 'https://...', style: { flex: '1', fontSize: '11px' } }));
            linkRow.appendChild(h('button', { className: 'btn-delete', style: { fontSize: '10px' }, onclick: () => { harvestEditorFields(fest); delete a.links[platform]; adminState.editFestival = fest; rerender(); } }, '×'));
            setBlock.appendChild(linkRow);
          });
        }
      });
      // Action buttons row
      const actionRow = h('div', { style: { display: 'flex', gap: '6px', marginTop: '4px' } });
      if ((set.artists || []).length < 4) {
        actionRow.appendChild(h('button', { className: 'btn btn-ghost', style: { fontSize: '10px', padding: '2px 6px' }, onclick: () => { harvestEditorFields(fest); set.artists.push({ name: '', links: {} }); adminState.editFestival = fest; rerender(); } }, '+ Artist'));
      }
      actionRow.appendChild(h('button', { className: 'btn btn-ghost', style: { fontSize: '10px', padding: '2px 6px' }, onclick: () => {
        harvestEditorFields(fest);
        // Add a link to the first artist that doesn't have one yet
        const targetArtist = set.artists?.find(a => !a.links?.spotify) || set.artists?.[0];
        if (targetArtist) { if (!targetArtist.links) targetArtist.links = {}; targetArtist.links.spotify = ''; }
        adminState.editFestival = fest; rerender();
      } }, '+ Link'));
      setBlock.appendChild(actionRow);
      sd.appendChild(setBlock);
    });
    dd.appendChild(sd);

    const setActions = h('div', { className: 'flex gap-2 mt-2' });
    setActions.appendChild(h('button', {
      className: 'btn btn-ghost btn-sm',
      onclick: () => {
        harvestEditorFields(fest);
        day.sets = day.sets || [];
        day.sets.push({ id: createClientOpaqueId('set'), artist: '', artists: [{ name: '', links: {} }], stageId: fest.stages?.[0]?.id || '', startTime: '', endTime: '' });
        adminState.editFestival = fest;
        rerender();
      },
    }, '+ Add Set'));
    if ((day.sets || []).length > 0) {
      setActions.appendChild(h('button', {
        className: 'btn btn-ghost btn-sm', style: { color: 'var(--accent-coral)' },
        onclick: async () => {
          const confirmed = await styledConfirm(`Clear all ${day.sets.length} sets from "${day.label || 'this day'}"?`, { confirmLabel: 'Clear All', confirmClass: 'btn btn-danger' });
          if (!confirmed) return;
          harvestEditorFields(fest);
          day.sets = [];
          adminState.editFestival = fest;
          rerender();
        },
      }, 'Clear Sets'));
    }
    dd.appendChild(setActions);
    dc.appendChild(dd);
  });
  panel.appendChild(dc);

  panel.appendChild(h('button', {
    className: 'btn btn-ghost btn-sm mt-2',
    onclick: () => {
      harvestEditorFields(fest);
      fest.days = fest.days || [];
      fest.days.push({ label: '', date: '', sets: [] });
      adminState.editFestival = fest;
      rerender();
    },
  }, '+ Add Day'));

  panel.appendChild(h('div', { className: 'flex gap-2 mt-4' },
    h('button', { className: 'btn btn-primary', onclick: () => _saveAdminFestival(fest, isEdit, deps) }, isEdit ? 'Save Changes' : 'Create Festival'),
    h('button', { className: 'btn btn-ghost', onclick: () => { adminState.tab = 'festivals'; adminState.editFestival = null; rerender(); } }, 'Cancel'),
  ));
}

async function _saveAdminFestival(fest, isEdit, deps) {
  const { api, adminApi, toast, render, harvestEditorFields, rerender } = deps;
  harvestEditorFields(fest);
  try {
    if (isEdit) await adminApi('/festivals/' + fest.id, { method: 'PUT', body: fest });
    else await adminApi('/festivals', { method: 'POST', body: fest });
    S.festivals = await api('/festivals');
    toast(isEdit ? 'Festival updated!' : 'Festival created!');
    adminState.tab = 'festivals';
    adminState.editFestival = null;
    rerender();
    render();
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}
