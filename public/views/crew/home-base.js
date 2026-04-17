/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Crew — home base + meeting points
 * Extracted from public/views/crew.js during the 2026-04-14 file-size split.
 * Functions: renderHomeBase, openHomeBaseEditor, renderMeetingPoints,
 *            openMeetingPointEditor, loadMeetingPoints
 */

import { S } from '../../app/state.js?v=1776342458439';
import { $, h } from '../../app/dom.js?v=1776342458439';

export function renderHomeBase(deps,crew){
  const card=h('div',{className:'home-base-card'+(crew.homeBaseLocation?'':' home-base-ghost')});
  if(crew.homeBaseLocation){
    const header=h('div',{className:'home-base-header'});
    header.appendChild(h('span',{className:'home-base-icon'},'\u{1F4CD}'));
    header.appendChild(h('span',{className:'home-base-label'},'Home Base'));
    if(crew.role==='owner'){header.appendChild(h('button',{className:'home-base-edit',type:'button',onclick:(e)=>{e.stopPropagation();openHomeBaseEditor(deps,crew)}},'Edit'))}
    card.appendChild(header);
    card.appendChild(h('div',{className:'home-base-location'},crew.homeBaseLocation));
    if(crew.homeBaseTime)card.appendChild(h('div',{className:'home-base-time'},crew.homeBaseTime));
  }else if(crew.role==='owner'){
    card.onclick=()=>openHomeBaseEditor(deps,crew);
    card.appendChild(h('div',{style:'text-align:center;color:var(--text-secondary);font-size:13px;padding:4px 0'},'\u{1F4CD} Set a meeting point for your crew'));
  }else{return h('div',{})}
  return card;
}

export function openHomeBaseEditor(deps,crew){
  const { openOverlay, trapFocus, toast, render } = deps;
  const existing=$('.homebase-editor-overlay');if(existing)existing.remove();
  const titleId='homebase-editor-title-'+Math.random().toString(36).slice(2,8);
  const ov=h('div',{className:'detail-overlay open homebase-editor-overlay',role:'dialog','aria-modal':'true','aria-labelledby':titleId,onclick:(e)=>{if(e.target===ov)closeOv()}});
  const closeOv=openOverlay(ov);
  const panel=h('div',{className:'detail-panel panel-entering'});
  panel.appendChild(h('button',{className:'detail-close',type:'button','aria-label':'Close home base dialog',onclick:closeOv},'×'));
  panel.appendChild(h('div',{className:'detail-artist',id:titleId},'\u{1F4CD} Set Home Base'));
  const locGroup=h('div',{className:'form-group'});
  locGroup.appendChild(h('label',{htmlFor:'homebase-location'},'Location'));
  const locInput=h('input',{type:'text',id:'homebase-location',className:'input',placeholder:'e.g. Left side of the Ferris wheel',maxLength:'200',value:crew.homeBaseLocation||''});
  locGroup.appendChild(locInput);
  panel.appendChild(locGroup);
  const timeGroup=h('div',{className:'form-group'});
  timeGroup.appendChild(h('label',{htmlFor:'homebase-time'},'Meetup Time (Optional)'));
  const timeInput=h('input',{type:'text',id:'homebase-time',className:'input',placeholder:'e.g. After Skrillex, around 9pm',maxLength:'100',value:crew.homeBaseTime||''});
  timeGroup.appendChild(timeInput);
  panel.appendChild(timeGroup);
  const btnRow=h('div',{style:'display:flex;gap:8px;justify-content:flex-end;margin-top:20px'});
  btnRow.appendChild(h('button',{className:'btn btn-ghost',type:'button',onclick:closeOv},'Cancel'));
  btnRow.appendChild(h('button',{className:'btn btn-primary',type:'button',onclick:async()=>{
    try{
      const resp=await(await fetch('/api/v1/crews/'+crew.id+'/home-base',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({location:locInput.value.trim(),time:timeInput.value.trim()})})).json();
      if(resp.error)throw new Error(resp.error);
      closeOv();render();
    }catch(e){toast(e.message||'Failed to save','error')}
  }},'Save'));
  panel.appendChild(btnRow);
  ov.appendChild(panel);
  ov.addEventListener('modal-close',()=>closeOv());
  requestAnimationFrame(()=>trapFocus(panel));
  document.body.appendChild(ov);
  requestAnimationFrame(()=>locInput.focus());
}



// Phase 1B: Meeting Points — multiple typed points per crew
export function renderMeetingPoints(deps, crew) {
  const { render, openOverlay, trapFocus, toast, createAvatar } = deps;
  const container = h('div', { className: 'meeting-points-section' });

  const header = h('div', { className: 'home-base-header', style: 'display:flex;align-items:center;justify-content:space-between;padding:8px 0' });
  const points = S._meetingPoints || [];
  header.appendChild(h('span', { style: 'font-weight:600;font-size:13px;color:var(--text-secondary)' },
    'Meeting Points' + (points.length > 0 ? ' (' + points.length + ')' : '')));

  // Any member can create
  header.appendChild(h('button', { className: 'btn btn-ghost btn-sm', type: 'button', style: 'font-size:12px', onclick: () => openMeetingPointEditor(deps, crew, null) }, '+ Add'));
  container.appendChild(header);

  if (points.length === 0) {
    container.appendChild(h('div', { style: 'text-align:center;color:var(--text-secondary);font-size:13px;padding:8px 0' },
      '\u{1F4CD} No meeting points set yet'));
    return container;
  }

  const TYPE_ICONS = { 'pre-show': '\u{1F3AA}', during: '\u{1F4CD}', 'post-show': '\u{1F3C1}', 'post-event': '\u{1F319}', emergency: '\u{1F6A8}', general: '\u{1F4CD}' };
  const TYPE_COLORS = { 'pre-show': 'var(--accent-aqua)', during: 'var(--text-primary)', 'post-show': 'var(--accent-amber)', 'post-event': 'var(--accent-blue,#5b9bd5)', emergency: 'var(--accent-coral,#ff6b6b)', general: 'var(--text-primary)' };

  points.forEach(mp => {
    const isEmergency = mp.type === 'emergency';
    const card = h('div', { className: 'home-base-card', style: isEmergency ? 'border-left:3px solid var(--accent-coral,#ff6b6b)' : '' });
    const cardHeader = h('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:4px' });
    cardHeader.appendChild(h('span', { style: 'font-size:16px' }, TYPE_ICONS[mp.type] || '\u{1F4CD}'));
    cardHeader.appendChild(h('span', { style: 'font-weight:600;font-size:14px;color:' + (TYPE_COLORS[mp.type] || 'var(--text-primary)') }, mp.label));
    card.appendChild(cardHeader);

    card.appendChild(h('div', { style: 'font-size:13px;color:var(--text-primary);padding:2px 0' }, mp.location));

    const meta = h('div', { style: 'display:flex;gap:8px;align-items:center;font-size:11px;color:var(--text-muted);margin-top:4px' });
    if (mp.meetAt) {
      const meetTime = new Date(mp.meetAt);
      const diff = meetTime.getTime() - Date.now();
      if (diff > 0 && diff < 24 * 60 * 60_000) {
        const hrs = Math.floor(diff / 3_600_000);
        const mins = Math.floor((diff % 3_600_000) / 60_000);
        meta.appendChild(h('span', { style: 'color:var(--accent-aqua)' }, 'in ' + (hrs > 0 ? hrs + 'h ' : '') + mins + 'm'));
      } else {
        meta.appendChild(h('span', {}, meetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
      }
    }
    if (mp.creatorName) meta.appendChild(h('span', {}, 'by ' + mp.creatorName));
    card.appendChild(meta);

    // Edit/delete for creator or owner
    if (mp.createdBy === S.currentUser?.id || crew.role === 'owner') {
      const actions = h('div', { style: 'display:flex;gap:6px;margin-top:6px' });
      actions.appendChild(h('button', { className: 'btn btn-ghost btn-sm', type: 'button', style: 'font-size:11px;padding:2px 8px',
        onclick: (e) => { e.stopPropagation(); openMeetingPointEditor(deps, crew, mp); } }, 'Edit'));
      actions.appendChild(h('button', { className: 'btn btn-ghost btn-sm', type: 'button', style: 'font-size:11px;padding:2px 8px;color:var(--accent-coral,#ff6b6b)',
        onclick: async (e) => {
          e.stopPropagation();
          try {
            const resp = await (await fetch('/api/v1/crews/' + crew.id + '/meeting-points/' + mp.id, {
              method: 'DELETE', credentials: 'same-origin' })).json();
            if (resp.error) throw new Error(resp.error);
            toast('Meeting point removed', 'success');
            await loadMeetingPoints(crew.id);
            render();
          } catch (err) { toast(err.message || 'Failed to remove', 'error'); }
        } }, 'Remove'));
      card.appendChild(actions);
    }

    container.appendChild(card);
  });
  return container;
}

export function openMeetingPointEditor(deps, crew, existing) {
  const { openOverlay, trapFocus, toast, render } = deps;
  const titleId = 'meeting-point-title-' + Math.random().toString(36).slice(2, 8);
  const ov = h('div', { className: 'detail-overlay open', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId,
    onclick: (e) => { if (e.target === ov) closeOv(); } });
  const closeOv = openOverlay(ov);
  const panel = h('div', { className: 'detail-panel panel-entering' });

  panel.appendChild(h('button', { className: 'detail-close', type: 'button', 'aria-label': 'Close meeting point dialog', onclick: closeOv }, '\u00D7'));
  panel.appendChild(h('div', { className: 'detail-artist', id: titleId }, existing ? '\u{1F4CD} Edit Meeting Point' : '\u{1F4CD} New Meeting Point'));

  // Type selector (pill buttons)
  const typeRow = h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px' });
  let selectedType = existing?.type || 'during';
  const TYPES = [
    ['pre-show', '\u{1F3AA} Pre-show'], ['during', '\u{1F4CD} During'], ['post-show', '\u{1F3C1} Post-show'],
    ['post-event', '\u{1F319} Post-event'], ['emergency', '\u{1F6A8} Emergency']
  ];
  TYPES.forEach(([val, label]) => {
    const btn = h('button', { className: 'btn btn-ghost btn-sm' + (selectedType === val ? ' active' : ''), type: 'button',
      style: 'font-size:12px;padding:4px 10px' + (selectedType === val ? ';background:var(--accent-aqua);color:var(--bg-primary)' : ''),
      onclick: () => {
        selectedType = val;
        typeRow.querySelectorAll('button').forEach(b => { b.style.background = ''; b.style.color = ''; });
        btn.style.background = 'var(--accent-aqua)'; btn.style.color = 'var(--bg-primary)';
      } }, label);
    typeRow.appendChild(btn);
  });
  panel.appendChild(typeRow);

  // Label input
  const labelGroup = h('div', { className: 'form-group' });
  labelGroup.appendChild(h('label', { htmlFor: 'mp-label' }, 'Label'));
  const labelInput = h('input', { type: 'text', id: 'mp-label', className: 'input', placeholder: 'e.g. Pre-show meetup', maxLength: '100', value: existing?.label || '' });
  labelGroup.appendChild(labelInput);
  panel.appendChild(labelGroup);

  // Location input
  const locGroup = h('div', { className: 'form-group' });
  locGroup.appendChild(h('label', { htmlFor: 'mp-location' }, 'Location'));
  const locInput = h('input', { type: 'text', id: 'mp-location', className: 'input', placeholder: 'e.g. Left of the Ferris wheel', maxLength: '200', value: existing?.location || '' });
  locGroup.appendChild(locInput);
  panel.appendChild(locGroup);

  // Time input (optional)
  const timeGroup = h('div', { className: 'form-group' });
  timeGroup.appendChild(h('label', { htmlFor: 'mp-time' }, 'Meet At (Optional)'));
  const timeInput = h('input', { type: 'datetime-local', id: 'mp-time', className: 'input',
    value: existing?.meetAt ? new Date(existing.meetAt).toISOString().slice(0, 16) : '' });
  timeGroup.appendChild(timeInput);
  panel.appendChild(timeGroup);

  // Buttons
  const btnRow = h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:20px' });
  btnRow.appendChild(h('button', { className: 'btn btn-ghost', type: 'button', onclick: closeOv }, 'Cancel'));
  btnRow.appendChild(h('button', { className: 'btn btn-primary', type: 'button', onclick: async () => {
    const label = labelInput.value.trim();
    const location = locInput.value.trim();
    if (!label || !location) { toast('Label and location are required', 'error'); return; }

    const body = { label, location, type: selectedType };
    if (timeInput.value) body.meetAt = new Date(timeInput.value).toISOString();

    try {
      const url = existing
        ? '/api/v1/crews/' + crew.id + '/meeting-points/' + existing.id
        : '/api/v1/crews/' + crew.id + '/meeting-points';
      const resp = await (await fetch(url, {
        method: existing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })).json();
      if (resp.error) throw new Error(resp.error);
      closeOv();
      toast(existing ? 'Meeting point updated' : 'Meeting point created', 'success');
      await loadMeetingPoints(crew.id);
      render();
    } catch (err) { toast(err.message || 'Failed to save', 'error'); }
  } }, existing ? 'Save' : 'Create'));
  panel.appendChild(btnRow);

  ov.appendChild(panel);
  ov.addEventListener('modal-close', () => closeOv());
  document.body.appendChild(ov);
  requestAnimationFrame(() => trapFocus(panel));
  requestAnimationFrame(() => labelInput.focus());
}

// Load meeting points for a crew (called from crews module)
export async function loadMeetingPoints(crewId) {
  try {
    const resp = await (await fetch('/api/v1/crews/' + crewId + '/meeting-points', { credentials: 'same-origin' })).json();
    if (resp.data?.meetingPoints) S._meetingPoints = resp.data.meetingPoints;
    else S._meetingPoints = [];
  } catch { S._meetingPoints = []; }
}
