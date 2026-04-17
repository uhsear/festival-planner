/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Crew — schedule overlap, conflicts, diff modal
 * Extracted from public/views/crew.js during the 2026-04-14 file-size split.
 * Functions: renderCrewSchedule, renderCrewConflicts, showCrewDiff
 */

import { S } from '../../app/state.js?v=1776342458439';
import { h } from '../../app/dom.js?v=1776342458439';
import { formatTime, timeToMinutes } from '../../app/helpers.js?v=1776342458439';

export function renderCrewSchedule(deps){
  const { getMyPick, getCrewScopedOtherPicks, getStageColor, getStageName, getDays, createAvatar, render } = deps;
  const container=h('div',{className:'crew-schedule'});
  if(!S.currentFestival||!S.activeCrew){container.appendChild(h('div',{className:'empty-state',style:'padding:2rem;text-align:center;color:var(--text-secondary)'},'Select a crew and festival'));return container}
  const days=getDays();const allSets=days.flatMap(d=>d.sets||[]).filter(s=>s.startTime&&s.endTime);
  const crewPickedSets=allSets.filter(s=>{
    const crewPicks=S.crewOverlap[s.id]||[];
    return crewPicks.length>0||getMyPick(s.id);
  }).sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||''));
  if(crewPickedSets.length===0){
    container.appendChild(h('div',{className:'empty-state',style:'padding:2rem;text-align:center'},'No crew picks yet'));
    return container;
  }
  container.appendChild(h('div',{style:'padding:8px 16px;color:var(--text-secondary);font-size:13px;font-weight:600'},crewPickedSets.length+' sets picked by crew'));
  const grid=h('div',{className:'crew-schedule-grid'});
  const totalMembers=S.crewMembers.length;
  crewPickedSets.forEach(s=>{
    const crewPicks=S.crewOverlap[s.id]||[];
    const myPick=getMyPick(s.id);
    const allPickers=[...crewPicks];
    if(myPick&&!crewPicks.some(p=>p.userId===S.user?.id)){
      allPickers.push({userId:S.user?.id,username:S.user?.username,priority:myPick});
    }
    const row=h('div',{className:'crew-sched-row',onclick:()=>{S.detailSet=s;render()},style:'cursor:pointer'});
    const stageColor=getStageColor(s.stageId);
    row.style.borderLeft='3px solid '+stageColor;
    const info=h('div',{className:'crew-sched-set-info'});
    info.appendChild(h('div',{className:'crew-sched-artist'},s.artist));
    info.appendChild(h('div',{className:'crew-sched-time'},formatTime(s.startTime)+' - '+formatTime(s.endTime)+' · '+getStageName(s.stageId)));
    row.appendChild(info);
    const avatars=h('div',{className:'crew-sched-avatars'});
    allPickers.slice(0,5).forEach(p=>{
      avatars.appendChild(createAvatar({username:p.username,avatarUrl:null},{className:'mini-avatar',size:22,fontSize:9,title:p.username+' ('+p.priority+')'}));
    });
    row.appendChild(avatars);
    if(allPickers.length===totalMembers){
      row.appendChild(h('span',{className:'crew-consensus-badge'},'All going!'));
    }else{
      row.appendChild(h('span',{className:'crew-sched-count'},allPickers.length+'/'+totalMembers));
    }
    grid.appendChild(row);
  });
  container.appendChild(grid);
  return container;
}

export function renderCrewConflicts(deps){
  const { getMyPick, getOtherPicks, getCrewScopedOtherPicks, getStageColor, getStageName, getDays, render, savePick } = deps;
  const container=h('div',{className:'crew-conflicts'});
  if(!S.currentProfile||!S.currentFestival){container.appendChild(h('div',{className:'empty-state',style:{padding:'2rem',textAlign:'center',color:'var(--text-secondary)'}},'Join a festival to see conflicts'));return container}
  const days=getDays();const allSets=days.flatMap(d=>d.sets||[]);
  const picked=allSets.filter(s=>getMyPick(s.id));
  const conflicts=[];const seen=new Set();
  for(let i=0;i<picked.length;i++){
    for(let j=i+1;j<picked.length;j++){
      const a=picked[i],b=picked[j];
      const aDay=days.find(d=>(d.sets||[]).some(s=>s.id===a.id));
      const bDay=days.find(d=>(d.sets||[]).some(s=>s.id===b.id));
      if(!aDay||!bDay||aDay.index!==bDay.index)continue;
      const aS=timeToMinutes(a.startTime);let aE=timeToMinutes(a.endTime);if(aE<=aS)aE+=1440;
      const bS=timeToMinutes(b.startTime);let bE=timeToMinutes(b.endTime);if(bE<=bS)bE+=1440;
      if(aS<bE&&bS<aE){const key=[a.id,b.id].sort().join('-');if(!seen.has(key)){seen.add(key);conflicts.push({a,b,day:aDay})}}
    }
  }
  if(conflicts.length===0){
    const empty=h('div',{className:'conflict-empty',style:'padding:3rem 2rem;text-align:center'});
    empty.appendChild(h('div',{style:'font-size:32px;margin-bottom:12px;opacity:.6'},'✓'));
    empty.appendChild(h('div',{style:'font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:4px'},'No conflicts!'));
    empty.appendChild(h('div',{style:'font-size:13px;color:var(--text-secondary)'},'Your schedule is clean — no overlapping picks.'));
    container.appendChild(empty);return container;
  }
  const pickLabel={'must':'Must See','want-to-see':'Want to See','maybe':'Maybe'};
  const pickColor={'must':'var(--priority-must)','want-to-see':'var(--priority-want)','maybe':'var(--priority-maybe)'};
  container.appendChild(h('div',{className:'conflict-count',style:'padding:12px 16px;color:var(--accent-coral);font-size:13px;font-weight:600'},'⚠ '+conflicts.length+' conflict'+(conflicts.length>1?'s':'')+' found'));
  conflicts.forEach(({a,b,day})=>{
    const card=h('div',{className:'conflict-card'});
    card.appendChild(h('div',{className:'conflict-day-label'},day.label||day.date||''));
    const row=h('div',{className:'conflict-row'});
    [a,b].forEach((set,idx)=>{
      const pick=getMyPick(set.id);const sc=getStageColor(set.stageId);
      const col=h('div',{className:'conflict-set',style:'border-color:'+sc,onclick:()=>{S.detailSet=set;render()}});
      if(pick){const badge=h('span',{className:'conflict-pick-badge',style:'background:'+pickColor[pick]+';color:'+(pick==='must'?'var(--text-primary)':'var(--bg-primary)')},pickLabel[pick]||pick);col.appendChild(badge)}
      col.appendChild(h('div',{className:'conflict-artist'},set.artist));
      col.appendChild(h('div',{className:'conflict-time'},formatTime(set.startTime)+' – '+formatTime(set.endTime)));
      col.appendChild(h('div',{className:'conflict-stage',style:'color:'+sc},getStageName(set.stageId)));
      const crewCount=S.activeCrew?getCrewScopedOtherPicks(set.id).length:getOtherPicks(set.id).length;
      if(crewCount>0)col.appendChild(h('div',{className:'conflict-crew'},crewCount+' crew going'));
      row.appendChild(col);
      if(idx===0)row.appendChild(h('div',{className:'conflict-vs'},'VS'));
    });
    card.appendChild(row);
    container.appendChild(card);
  });
  return container;
}

export function showCrewDiff(otherProfile,deps){
  const { openOverlay, trapFocus, getDays, getMyPick, getStageColor, getStageName, render } = deps;
  const ov=h('div',{className:'detail-overlay open crew-diff-modal',role:'dialog','aria-modal':'true','aria-labelledby':'crew-diff-title',onclick:(e)=>{if(e.target===ov)closeOv()}});const closeOv=openOverlay(ov);ov.addEventListener('modal-close',()=>closeOv());const panel=h('div',{className:'detail-panel panel-entering',style:{maxWidth:'600px'}});panel.appendChild(h('button',{className:'detail-close','aria-label':'Close comparison',type:'button',onclick:closeOv},'\u00D7'));panel.appendChild(h('div',{className:'detail-artist',id:'crew-diff-title'},'Schedule Comparison'));panel.appendChild(h('div',{className:'detail-time'},'You vs '+otherProfile.name));const days=getDays();const allSets=days.flatMap(d=>d.sets||[]);const myPicks=S.currentProfile?.picks||{};const theirPicks=otherProfile.picks||{};const shared=allSets.filter(s=>myPicks[s.id]&&theirPicks[s.id]);const onlyMe=allSets.filter(s=>myPicks[s.id]&&!theirPicks[s.id]);const onlyThem=allSets.filter(s=>!myPicks[s.id]&&theirPicks[s.id]);const renderDiffSection=(title,sets,color,icon)=>{const sec=h('div',{className:'picks-section',style:{marginTop:'16px'}});const t=h('div',{className:'picks-section-title'});t.appendChild(h('div',{className:'dot',style:{background:color}}));t.appendChild(h('span',{},title));t.appendChild(h('span',{className:'count'},String(sets.length)));sec.appendChild(t);sets.sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||'')).forEach(s=>{const item=h('div',{className:'pick-item'});item.appendChild(h('div',{className:'pick-time'},formatTime(s.startTime)+' - '+formatTime(s.endTime)));item.appendChild(h('div',{className:'pick-artist'},icon+' '+s.artist));item.appendChild(h('span',{className:'pick-stage',style:{background:getStageColor(s.stageId)+'25',color:getStageColor(s.stageId)}},getStageName(s.stageId)));sec.appendChild(item)});if(sets.length===0)sec.appendChild(h('div',{style:{padding:'10px',color:'var(--text-muted)',fontSize:'13px'}},'None'));return sec};panel.appendChild(renderDiffSection('Both going ('+shared.length+')',shared,'var(--accent-green)','🤝'));panel.appendChild(renderDiffSection('Only you ('+onlyMe.length+')',onlyMe,'var(--accent-coral)','👤'));panel.appendChild(renderDiffSection('Only '+otherProfile.name+' ('+onlyThem.length+')',onlyThem,'var(--accent-aqua)','👥'));ov.appendChild(panel);document.body.appendChild(ov)
}
