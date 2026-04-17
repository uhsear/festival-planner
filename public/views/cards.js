/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Card grid view — schedule as browsable cards
 * Extracted from app.js for modularity
 */

import { S, PRI_MAP } from '../app/state.js?v=1776342458439';
import { h } from '../app/dom.js?v=1776342458439';
import { formatTime, getSetHotness, artistDisplayName, artistSubtitle } from '../app/helpers.js?v=1776342458439';

/**
 * renderCardGrid — Card grid view
 * deps: { filteredSets, getMyPick, getOtherPicks, getCrewScopedOtherPicks, getMyNote,
 *         getStageColor, getStageName, getConflicts, savePick, showWhosGoing,
 *         createAvatar, render, _viewChanged }
 */
export function renderCardGrid(deps){
  const { filteredSets, getMyPick, getOtherPicks, getCrewScopedOtherPicks, getMyNote,
          getStageColor, getStageName, getConflicts, savePick, showWhosGoing,
          createAvatar, render, _viewChanged, spotify } = deps;
  const grid=h('div',{className:'card-grid',role:'region','aria-label':'Card view'});const sets=filteredSets().sort((a,b)=>{
    const ha=getSetHotness(a),hb=getSetHotness(b);
    if(ha>0||hb>0)return hb-ha;
    const aT=a.startTime||'';const bT=b.startTime||'';if(aT&&bT)return aT.localeCompare(bT);if(aT&&!bT)return -1;if(!aT&&bT)return 1;return artistDisplayName(a,S.currentFestival?.b2bSeparator).localeCompare(artistDisplayName(b,S.currentFestival?.b2bSeparator),undefined,{sensitivity:'base'});
  });
  sets.forEach(set=>{const myPick=getMyPick(set.id);const others=S.activeCrew?getCrewScopedOtherPicks(set.id):getOtherPicks(set.id);const note=getMyNote(set.id);const sc=getStageColor(set.stageId);const sn=getStageName(set.stageId);const priClass=myPick?' priority-'+(PRI_MAP[myPick]||''):'';
    const conflicts=getConflicts(set.id);
    const _dn=artistDisplayName(set,S.currentFestival?.b2bSeparator);
    const card=h('button',{className:'set-card'+priClass,'data-testid':'set-card','data-artist':_dn,type:'button','aria-label':_dn+' — '+sn+' '+(set.startTime?formatTime(set.startTime):'TBA'),onclick:()=>{S.detailSet=set;render()}});
    if(note)card.appendChild(h('div',{className:'card-note-indicator'},'📝'));
    if(conflicts.length>0)card.appendChild(h('div',{className:'conflict-badge'},'⚠ Conflict'));
    card.appendChild(h('span',{className:'card-stage',style:{background:sc+'25',color:sc}},sn));
    card.appendChild(h('div',{className:'card-artist'},_dn));const _sub=artistSubtitle(set,S.currentFestival?.b2bSeparator);if(_sub)card.appendChild(h('div',{className:'card-artist-sub'},_sub));
    card.appendChild(h('div',{className:'card-time'},set.startTime&&set.endTime?formatTime(set.startTime)+' - '+formatTime(set.endTime):'TBA'));
    const footer=h('div',{className:'card-footer'});const priGroup=h('div',{className:'card-priority'});
    if(S.currentProfile){[['must','★'],['want-to-see','◆'],['maybe','●']].forEach(([p,icon])=>{const active=myPick===p;const cls='card-priority-btn'+(active?` active-${PRI_MAP[p]}`:'');priGroup.appendChild(h('button',{className:cls,type:'button','aria-pressed':active?'true':'false','aria-label':(p==='must'?'Must See':p==='want-to-see'?'Want to See':'Maybe')+(active?' (selected)':''),title:p==='must'?'Must See':p==='want-to-see'?'Want to See':'Maybe',onclick:async(e)=>{e.preventDefault();e.stopPropagation();const btn=e.currentTarget;btn.setAttribute('aria-busy','true');btn.classList.remove('just-picked');void btn.offsetWidth;btn.classList.add('just-picked');try{await savePick(set.id,active?null:p)}finally{btn.removeAttribute('aria-busy')}}},icon))});footer.appendChild(priGroup)}
    if(others.length>0){const ov=h('button',{className:'card-overlap',type:'button','aria-label':others.length+' crew members going to '+_dn,onclick:(e)=>{e.stopPropagation();showWhosGoing(set.id,set.artist)}});
      ov.appendChild(h('span',{className:'crew-count-badge'},others.length===1?'1 going':others.length+' going'));
      footer.appendChild(ov)}
    // Spotify preview button (compact, shown if set has spotify link)
    if(spotify&&set.artists?.some(a=>a.links?.spotify)){
      const prevBtn=h('button',{className:'card-preview-btn',type:'button','aria-label':'Preview '+_dn,onclick:(e)=>{e.stopPropagation();e.preventDefault();spotify.play(set.id).catch(()=>{})}},'\u25B6');
      // Update button state based on playback
      const unsub=spotify.onStateChange((id,isPlaying)=>{if(id===set.id){prevBtn.textContent=isPlaying?'\u23F8':'\u25B6';prevBtn.classList.toggle('playing',isPlaying)}else if(prevBtn.classList.contains('playing')){prevBtn.textContent='\u25B6';prevBtn.classList.remove('playing')}});
      // Pre-fetch on card hover for faster play
      prevBtn.addEventListener('mouseenter',()=>spotify.fetchPreview(set.id),{once:true});
      card.addEventListener('remove',unsub);
      footer.appendChild(prevBtn);
    }
    card.appendChild(footer);if(_viewChanged){card.classList.add('card-enter');card.style.animationDelay=`${Math.min(grid.children.length*30,600)}ms`}grid.appendChild(card)});
  if(sets.length===0)grid.appendChild(h('div',{className:'no-festival',role:'status','aria-live':'polite',style:{gridColumn:'1/-1'}},h('p',{},S.searchQuery?'No artists match your search.':'No sets for this day.')));
  return grid
}
