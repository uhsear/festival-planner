/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Picks views — My Picks, Group (People), All Picks
 * Extracted from app.js for modularity
 */

import { S, PRI_MAP } from '../app/state.js?v=1776342458439';
import { h } from '../app/dom.js?v=1776342458439';
import { formatTime, getAvatarColor, getInitials, artistDisplayName } from '../app/helpers.js?v=1776342458439';

/**
 * renderPicks — My Picks view with priority grouping and export
 * deps: { getDays, getMyPick, getMyNote, getStageColor, getStageName, getOtherPicks, getConflicts,
 *         savePick, createAvatar, render, doExport, doExportCalendar, toast, _viewChanged }
 */
export function renderPicks(deps){
  const { getDays, getMyPick, getMyNote, getStageColor, getStageName, getOtherPicks, getConflicts, savePick, createAvatar, render, doExport, doExportCalendar, toast, _viewChanged } = deps;
  const container=h('div',{className:'picks-container',role:'region','aria-label':'My picks'});
  if(!S.user){
    const t=h('div',{className:'guest-teaser'});
    t.appendChild(h('div',{className:'empty-state-icon'},'★'));
    t.appendChild(h('h2',{style:{margin:'12px 0 8px',fontSize:'18px',color:'var(--text-primary)'}},'Save your festival picks'));
    t.appendChild(h('p',{style:{color:'var(--text-secondary)',fontSize:'14px',maxWidth:'280px',margin:'0 auto 16px'}},'Sign in to mark artists as Must See, Want to See, or Maybe — sync across devices and share with your crew.'));
    t.appendChild(h('button',{className:'btn btn-primary',type:'button',onclick:()=>{S.authMode='register';if(deps.render)deps.render()}},'Sign Up Free'));
    container.appendChild(t);return container;
  }
  if(!S.currentProfile||!S.currentFestival){container.appendChild(h('div',{className:'no-festival'},h('p',{},'Select a festival first.')));return container}
  const days=getDays();
  const dayFilterRow=h('div',{className:'picks-day-filter'});
  dayFilterRow.setAttribute('role','tablist');dayFilterRow.setAttribute('aria-label','Filter by day');
  dayFilterRow.appendChild(h('button',{className:'day-tab'+(S.picksDay===null?' active':''),role:'tab','aria-selected':S.picksDay===null?'true':'false',onclick:()=>{S.picksDay=null;render()}},'All Days'));
  days.forEach((d,i)=>{dayFilterRow.appendChild(h('button',{className:'day-tab'+(S.picksDay===i?' active':''),role:'tab','aria-selected':S.picksDay===i?'true':'false',onclick:()=>{S.picksDay=i;render()}},d.label))});
  container.appendChild(dayFilterRow);
  if(S.picksDay!==null&&S.picksDay>=days.length)S.picksDay=null;
  const filteredDays=S.picksDay!==null?[days[S.picksDay]].filter(Boolean):days;
  const allSets=filteredDays.flatMap(d=>d.sets||[]);
  [['must','Must See','var(--priority-must)'],['want-to-see','Want to See','var(--priority-want)'],['maybe','Maybe','var(--priority-maybe)']].forEach(([pri,label,color])=>{
    const section=h('div',{className:'picks-section'});const items=allSets.filter(s=>getMyPick(s.id)===pri).sort((a,b)=>{const aT=a.startTime||'';const bT=b.startTime||'';if(aT&&bT)return aT.localeCompare(bT);if(aT&&!bT)return -1;if(!aT&&bT)return 1;return artistDisplayName(a,S.currentFestival?.b2bSeparator).localeCompare(artistDisplayName(b,S.currentFestival?.b2bSeparator),undefined,{sensitivity:'base'})});
    const title=h('div',{className:'picks-section-title'});title.appendChild(h('div',{className:'dot',style:{background:color}}));title.appendChild(h('span',{},label));title.appendChild(h('span',{className:'count'},String(items.length)));section.appendChild(title);
    items.forEach(s=>{const others=getOtherPicks(s.id);const sc=getStageColor(s.stageId);const sn=getStageName(s.stageId);const dayLabel=days.find(d=>(d.sets||[]).some(ds=>ds.id===s.id))?.label||'';
      const conflicts=getConflicts(s.id);
      const _dn=artistDisplayName(s,S.currentFestival?.b2bSeparator);
      const item=h('button',{className:'pick-item',type:'button','aria-label':_dn+' — '+dayLabel+(s.startTime?' '+formatTime(s.startTime):' TBA'),onclick:()=>{S.detailSetTrigger=item;S.detailSet=s;render()}});item.appendChild(h('div',{className:'pick-time'},dayLabel+(s.startTime?' '+formatTime(s.startTime):' TBA')));item.appendChild(h('div',{className:'pick-artist'},_dn));
      if(conflicts.length>0)item.appendChild(h('span',{className:'pick-conflict'},'⚠ '+conflicts.map(c=>artistDisplayName(c,S.currentFestival?.b2bSeparator)).join(', ')));
      item.appendChild(h('span',{className:'pick-stage',style:{background:sc+'25',color:sc}},sn));
      if(others.length>0){const friends=h('div',{className:'pick-friends'});others.forEach(o=>friends.appendChild(createAvatar(o,{className:'mini-avatar',size:22,fontSize:9,title:o.name+' ('+o.priority+')'})));item.appendChild(friends)}else{item.appendChild(h('span',{className:'pick-solo-badge'},'Solo'))}
      if(_viewChanged){item.classList.add('card-enter');item.style.animationDelay=`${(section.children.length-1)*30}ms`}section.appendChild(item)});
    if(items.length===0){const emptyGuide=h('div',{className:'empty-state-guide'});emptyGuide.appendChild(h('div',{className:'empty-state-icon'},pri==='must'?'★':pri==='want-to-see'?'◆':'●'));emptyGuide.appendChild(h('div',{className:'empty-state-text'},pri==='must'?'Tap ★ on any set to mark it as must-see.':pri==='want-to-see'?'Tap ◆ on sets you\'d like to catch.':'Tap ● on sets you\'re considering.'));section.appendChild(emptyGuide)}
    container.appendChild(section)});
  const exportSection=h('div',{className:'picks-export-section',style:{marginTop:'24px',padding:'16px',background:'var(--bg-card)',borderRadius:'var(--radius-sm)',border:'1px solid var(--border)'}});
  exportSection.appendChild(h('div',{className:'picks-section-title',style:{marginBottom:'8px'}},h('div',{className:'dot',style:{background:'var(--accent-aqua)'}}),h('span',{},'Export Schedule')));
  exportSection.appendChild(h('p',{style:{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'12px'}},'Export your schedule for printing or import your picks into your phone calendar.'));
  const exportBtns=h('div',{style:{display:'flex',gap:'8px',flexWrap:'wrap'}});
  exportBtns.appendChild(h('button',{className:'btn btn-primary btn-sm',type:'button','data-testid':'picks-export-pdf',onclick:doExport},'Export Schedule'));
  exportBtns.appendChild(h('button',{className:'btn btn-ghost btn-sm',type:'button','data-testid':'picks-export-ics',onclick:doExportCalendar},'Add to Calendar (.ics)'));
  exportBtns.appendChild(h('button',{className:'btn btn-ghost btn-sm',type:'button','data-testid':'picks-share-image',onclick:async()=>{
    try{const url='/api/v1/export-card/'+S.currentFestival.id;const resp=await fetch(url,{credentials:'same-origin'});
    const blob=await resp.blob();const file=new File([blob],'my-picks.png',{type:'image/png'});
    if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'My Festival Picks'});return}
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='my-picks.png';a.click();URL.revokeObjectURL(a.href);
    toast('Picks card downloaded!','success')}catch(e){toast(e.message||'Failed to generate card','error')}}},'Share as Image'));
  exportBtns.appendChild(h('button',{className:'btn btn-ghost btn-sm',type:'button','data-testid':'picks-calendar-sync',onclick:async()=>{try{const resp=await fetch('/api/v1/calendar-sync/'+S.currentFestival.id,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Festie-Request':'1'}});const data=await resp.json();if(data.ok&&data.data?.url){await navigator.clipboard?.writeText(data.data.url);deps.toast('Calendar sync URL copied! Paste into Google Calendar or Apple Calendar.','success')}else{deps.toast('Failed to generate sync URL','error')}}catch(e){deps.toast(e.message||'Failed','error')}}},'Subscribe Calendar'));
  exportBtns.appendChild(h('button',{className:'btn btn-ghost btn-sm',type:'button','data-testid':'picks-share-link',onclick:()=>{const shareUrl=`${window.location.origin}/s/${S.currentProfile.id}`;navigator.clipboard?.writeText(shareUrl).then(()=>toast('Share link copied!','success')).catch(()=>{prompt('Copy this link:',shareUrl)})}},'Share My Picks'));
  exportSection.appendChild(exportBtns);
  container.appendChild(exportSection);
  return container
}

/**
 * renderGroup — People tab showing all profiles with their picks
 * deps: { getDays, getMyPick, getOtherPicks, getCrewScopedProfiles, getCrewScopedOtherPicks,
 *         createAvatar, savePick, render, toast, showCrewDiff, createIdentityBadge, _viewChanged }
 */
export function renderGroup(deps){
  const { getDays, getMyPick, getOtherPicks, getCrewScopedProfiles, createAvatar, savePick, render, toast, showCrewDiff, createIdentityBadge, _viewChanged } = deps;
  const container=h('div',{className:'group-container'});
  if(!S.currentFestival){container.appendChild(h('div',{className:'no-festival'},h('p',{},'Select a festival first.')));return container}
  const days=getDays();const allSets=days.flatMap(d=>d.sets||[]);
  const profiles=getCrewScopedProfiles();
  if(S.activeCrew&&profiles.length===0){container.appendChild(h('div',{className:'empty-state-guide'},h('div',{className:'empty-state-icon'},'👥'),h('div',{className:'empty-state-text'},'No crew members have joined this festival yet.')));return container}
  profiles.forEach(prof=>{const isMe=prof.id===S.currentProfile?.id;const picked=allSets.filter(s=>prof.picks?.[s.id]);
    const member=h('div',{className:'group-member'+(isMe?' group-member-self':'')});const header=h('button',{className:'group-member-header',type:'button','aria-expanded':'false',onclick:()=>{const expanded=member.classList.toggle('expanded');header.setAttribute('aria-expanded',expanded?'true':'false')}});
    header.appendChild(createAvatar(prof,{size:36,fontSize:14}));
    const identity=h('div',{className:'member-identity'});const copy=h('div',{className:'member-copy'});copy.appendChild(h('div',{className:'member-name'},prof.name));copy.appendChild(h('div',{className:'member-subline'},picked.length>0?`${picked.length} saved sets`:'No picks saved yet'));identity.appendChild(copy);if(isMe)identity.appendChild(createIdentityBadge('You','identity-badge-self'));header.appendChild(identity);
    const musts=picked.filter(s=>prof.picks[s.id]==='must').length;const wants=picked.filter(s=>prof.picks[s.id]==='want-to-see').length;const maybes=picked.filter(s=>prof.picks[s.id]==='maybe').length;
    header.appendChild(h('div',{className:'member-stats'},`★${musts}  ◆${wants}  ●${maybes}`));
    if(!isMe&&S.currentProfile){header.appendChild(h('button',{className:'btn btn-ghost btn-sm crew-diff-btn',type:'button',onclick:(e)=>{e.stopPropagation();showCrewDiff(prof)},'aria-label':'Compare schedules'},'Compare'))}member.appendChild(header);
    const setsDiv=h('div',{className:'group-member-sets'});
    picked.sort((a,b)=>{const aT=a.startTime||"";const bT=b.startTime||"";if(aT&&bT)return aT.localeCompare(bT);if(aT&&!bT)return -1;if(!aT&&bT)return 1;return artistDisplayName(a,S.currentFestival?.b2bSeparator).localeCompare(artistDisplayName(b,S.currentFestival?.b2bSeparator),undefined,{sensitivity:"base"})}).forEach(s=>{const pri=prof.picks[s.id];const color={must:'var(--priority-must)','want-to-see':'var(--priority-want)',maybe:'var(--priority-maybe)'}[pri];
      const dayLabel=days.find(d=>(d.sets||[]).some(ds=>ds.id===s.id))?.label||'';const row=h('div',{className:'group-set-item'});
      row.appendChild(h('div',{className:'priority-dot',style:{background:color}}));row.appendChild(h('span',{},artistDisplayName(s,S.currentFestival?.b2bSeparator)));
      row.appendChild(h('span',{style:{color:'var(--text-muted)',fontSize:'11px'}},dayLabel+(s.startTime?' '+formatTime(s.startTime):' TBA')));
      if(!isMe&&S.currentProfile?.picks?.[s.id])row.appendChild(h('span',{className:'overlap-highlight'},'🤝 You too!'));
      else if(!isMe&&S.currentProfile&&!S.currentProfile.picks?.[s.id]){row.appendChild(h('button',{className:'btn btn-ghost btn-sm quick-add-btn',type:'button',style:{fontSize:'10px',padding:'2px 6px'},onclick:(e)=>{e.stopPropagation();savePick(s.id,pri);toast(artistDisplayName(s,S.currentFestival?.b2bSeparator)+' added!','success')}},'+ Me too'))}
      setsDiv.appendChild(row)});
    if(picked.length===0)setsDiv.appendChild(h('div',{style:{padding:'10px 0',color:'var(--text-muted)',fontSize:'13px',fontStyle:'italic'}},'No picks yet.'));
    member.appendChild(setsDiv);if(_viewChanged){member.classList.add('card-enter');member.style.animationDelay=`${container.children.length*40}ms`}container.appendChild(member)});
  if(profiles.length<=1){const crewGuide=h('div',{className:'empty-state-guide',style:{marginTop:'16px'}});crewGuide.appendChild(h('div',{className:'empty-state-icon'},'👥'));
    if(S.activeCrew){crewGuide.appendChild(h('div',{className:'empty-state-text'},'Share the invite link with friends to join your crew.'));if(S.activeCrew.inviteCode){const inviteUrl=`${window.location.origin}/api/v1/crews/join/${S.activeCrew.inviteCode}`;crewGuide.appendChild(h('div',{className:'empty-state-action'},h('button',{className:'btn btn-primary btn-sm',type:'button',onclick:()=>{navigator.clipboard?.writeText(inviteUrl).then(()=>toast('Invite link copied!','success')).catch(()=>{prompt('Copy this invite link:',inviteUrl)})}},'Copy Invite Link')))}}
    else{crewGuide.appendChild(h('div',{className:'empty-state-text'},'Share the festival link with friends to build your crew and see who\'s going to what.'));crewGuide.appendChild(h('div',{className:'empty-state-action'},h('button',{className:'btn btn-primary btn-sm',type:'button',onclick:()=>{navigator.clipboard?.writeText(window.location.href).then(()=>toast('Link copied!','success')).catch(()=>toast('Copy the URL from your browser bar','info'))}},'Copy Link')))}
    container.appendChild(crewGuide)}
  return container
}

/**
 * renderAllPicks — Sets tab showing all picked sets grouped by day
 * deps: { getDays, getCrewScopedProfiles, getStageColor, getStageName, createAvatar, render }
 */
export function renderAllPicks(deps){
  const { getDays, getCrewScopedProfiles, getStageColor, getStageName, createAvatar, render } = deps;
  const container=h('div',{className:'picks-container',role:'region','aria-label':'My picks'});
  if(!S.currentFestival){container.appendChild(h('div',{className:'no-festival'},h('p',{},'Select a festival first.')));return container}
  const days=getDays();
  const profiles=getCrewScopedProfiles();
  const picks={};profiles.forEach(prof=>{days.forEach(d=>{(d.sets||[]).forEach(s=>{if(prof.picks?.[s.id]){if(!picks[s.id])picks[s.id]={set:s,byPriority:{},totalPickers:0};if(!picks[s.id].byPriority[prof.picks[s.id]])picks[s.id].byPriority[prof.picks[s.id]]=[];picks[s.id].byPriority[prof.picks[s.id]].push(prof);picks[s.id].totalPickers++}})})});
  const hasPicks=Object.keys(picks).length>0;
  if(!hasPicks){container.appendChild(h('div',{className:'no-festival'},h('p',{},'No one has made any picks yet.')));return container}
  days.forEach(day=>{
    const daySets=(day.sets||[]).filter(s=>picks[s.id]).sort((a,b)=>{const aT=a.startTime||"";const bT=b.startTime||"";return aT.localeCompare(bT)});
    if(daySets.length===0)return;
    const section=h('div',{className:'picks-section'});
    const title=h('div',{className:'picks-section-title'});
    title.appendChild(h('div',{className:'dot',style:{background:'var(--accent-aqua)'}}));
    title.appendChild(h('span',{},day.label||day.date||'Day'));
    title.appendChild(h('span',{className:'count'},String(daySets.length)+' sets'));
    section.appendChild(title);
    daySets.forEach(s=>{const _adn=artistDisplayName(s,S.currentFestival?.b2bSeparator);const p=picks[s.id];const item=h('button',{className:'pick-item',type:'button','aria-label':_adn+' — '+formatTime(s.startTime),onclick:()=>{S.detailSetTrigger=item;S.detailSet=s;render()}});
      item.appendChild(h('div',{className:'pick-time'},formatTime(s.startTime)+' - '+formatTime(s.endTime)));
      item.appendChild(h('div',{className:'pick-artist'},_adn));
      const sc=getStageColor(s.stageId);const sn=getStageName(s.stageId);
      item.appendChild(h('span',{className:'pick-stage',style:{background:sc+'25',color:sc}},sn));
      const avatars=h('div',{className:'pick-friends'});
      ['must','want-to-see','maybe'].forEach(pri=>{(p.byPriority[pri]||[]).forEach(prof=>{
        const av=createAvatar(prof,{className:'mini-avatar',size:22,fontSize:9,style:{opacity:pri==='must'?'1':pri==='want-to-see'?'0.7':'0.5'},title:`${prof.name} (${pri})`});
        avatars.appendChild(av)})});
      if(avatars.children.length>0)item.appendChild(avatars);
      section.appendChild(item)});
    container.appendChild(section)});
  return container
}
