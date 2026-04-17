/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Detail panel — bottom sheet showing set details, priorities, notes, crew overlap
 */

import { S } from '../app/state.js?v=1776342458439';
import { h } from '../app/dom.js?v=1776342458439';
import { formatTime, getAvatarColor, getInitials, artistDisplayName, artistSubtitle, getSetLinks } from '../app/helpers.js?v=1776342458439';
import { renderRatingButtons, renderRatingBadge, hasSetStarted } from '../app/ratings.js?v=1776342458439';

const PLATFORM_LABELS = { spotify: 'Spotify', soundcloud: 'SoundCloud', instagram: 'Instagram', twitter: 'X', tiktok: 'TikTok', website: 'Website' };

/**
 * renderDetailPanel — Bottom sheet set detail view
 */
export function renderDetailPanel(set,deps){
  const { getMyPick, getOtherPicks, getCrewScopedOtherPicks, getStageColor, getStageName,
          getConflicts, getMyNote, savePick, saveNote, saveReminder, createAvatar, render,
          trapFocus, joinCurrentFestival, spotify } = deps;

  function closeDetail(){
    const p=overlay.querySelector('.detail-panel');const trigger=S.detailSetTrigger;
    if(p){p.classList.remove('panel-entering');p.classList.add('panel-exiting');p.addEventListener('animationend',()=>{S.detailSet=null;S.detailSetTrigger=null;render();if(trigger)requestAnimationFrame(()=>trigger.focus())},{once:true})}
    else{S.detailSet=null;S.detailSetTrigger=null;render();if(trigger)requestAnimationFrame(()=>trigger.focus())}
  }

  const overlay=h('div',{className:'detail-overlay open',role:'dialog','aria-modal':'true','aria-labelledby':'detail-panel-title',onclick:(e)=>{if(e.target===overlay)closeDetail()}});
  const panel=h('div',{className:'detail-panel'});
  const closeBtn=h('button',{className:'detail-close',type:'button','aria-label':'Close details',onclick:closeDetail},'\u00D7');
  panel.appendChild(closeBtn);

  const titleId='detail-panel-title';
  const sc=getStageColor(set.stageId);const sn=getStageName(set.stageId);
  panel.appendChild(h('div',{className:'detail-stage-badge',style:{background:sc+'25',color:sc}},sn));

  // Artist photo (from Spotify)
  const primaryArtist=set.artists?.[0];
  if(primaryArtist?.photo){
    const photoWrap=h('div',{className:'detail-artist-photo-wrap'});
    const photo=h('img',{src:primaryArtist.photo,alt:primaryArtist.name||set.artist,className:'detail-artist-photo',loading:'lazy',onerror:()=>{photoWrap.remove()}});
    photoWrap.appendChild(photo);
    panel.appendChild(photoWrap);
  }

  panel.appendChild(h('div',{className:'detail-artist',id:titleId},artistDisplayName(set,S.currentFestival?.b2bSeparator)));
  const _dsub=artistSubtitle(set,S.currentFestival?.b2bSeparator);
  if(_dsub)panel.appendChild(h('div',{className:'detail-artist-sub'},_dsub));

  // Genre chips (from Spotify)
  const allGenres=[...new Set((set.artists||[]).flatMap(a=>a.genres||[]))].slice(0,6);
  if(allGenres.length>0){
    const genreRow=h('div',{className:'detail-genre-chips'});
    allGenres.forEach(g=>genreRow.appendChild(h('span',{className:'detail-genre-chip'},g)));
    panel.appendChild(genreRow);
  }

  const artistLinks=getSetLinks(set);
  if(artistLinks.length>0){
    const linksSection=h('div',{className:'detail-links'});
    const isB2B=set.artists?.length>1;
    artistLinks.forEach(a=>{
      if(isB2B){linksSection.appendChild(h('div',{style:{fontSize:'12px',fontWeight:600,color:'var(--text-secondary)',marginTop:'6px'}},a.name))}
      const linkRow=h('div',{className:'detail-link',style:{display:'flex',gap:'10px',flexWrap:'wrap'}});
      Object.entries(a.links||{}).forEach(([platform,url])=>{
        linkRow.appendChild(h('a',{href:url,target:'_blank',rel:'noopener noreferrer',style:{color:'var(--accent-aqua)',fontSize:'13px',textDecoration:'none'}},(PLATFORM_LABELS[platform]||platform)+' \u2197'))
      });
      if(linkRow.children.length>0)linksSection.appendChild(linkRow)
    });
    if(linksSection.children.length>0)panel.appendChild(linksSection)
  }

  panel.appendChild(h('div',{className:'detail-time'},set.startTime&&set.endTime?formatTime(set.startTime)+' - '+formatTime(set.endTime):'TBA'));

  // Rating badge
  const ratingBadge=renderRatingBadge(set.id);
  if(ratingBadge)panel.appendChild(ratingBadge);

  // Rating buttons (after set starts)
  if(S.currentProfile&&hasSetStarted(set,S.currentFestival)){
    const ratingSection=h('div',{className:'detail-rating-section'});
    ratingSection.appendChild(h('div',{className:'detail-rating-title'},'Rate this set'));
    ratingSection.appendChild(renderRatingButtons(set.id,{compact:false}));
    panel.appendChild(ratingSection);
  }

  // Spotify embed player
  if(spotify){
    const spotifySection=h('div',{className:'detail-spotify-section',style:'margin:10px 0'});
    const listenBtn=h('button',{className:'btn btn-ghost btn-sm',type:'button',style:'display:flex;align-items:center;gap:6px',onclick:async()=>{
      const embedData=await spotify.getEmbedHtml(set.id);
      if(!embedData)return;
      const existing=spotifySection.querySelector('.detail-spotify-embed');
      if(existing){existing.remove();listenBtn.textContent='\u25B6 Listen on Spotify';return}
      const wrap=h('div',{className:'detail-spotify-embed'});
      const iframe=document.createElement('iframe');
      iframe.src=embedData.embedUrl;iframe.width='100%';iframe.height='152';
      iframe.frameBorder='0';iframe.allow='autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
      iframe.loading='lazy';iframe.title='Spotify: '+embedData.label;
      wrap.appendChild(iframe);spotifySection.appendChild(wrap);
      listenBtn.textContent='\u25B2 Hide Player';
    }},'\u25B6 Listen on Spotify');
    spotify.fetchPreview(set.id).then(p=>{if(p?.embedType){spotifySection.appendChild(listenBtn);panel.insertBefore(spotifySection,panel.querySelector('.detail-priority-group')||panel.querySelector('.detail-friends'))}});
  }

  // Conflict warning
  const conflicts=getConflicts(set.id);
  if(conflicts.length>0){
    const cw=h('div',{className:'detail-conflict-warning'});
    cw.appendChild(h('div',{},'\u26A0 Time conflict with: '+conflicts.map(c=>artistDisplayName(c,S.currentFestival?.b2bSeparator)).join(', ')));
    const compare=h('div',{className:'detail-conflict-compare'});
    conflicts.forEach(c=>{
      const card=h('div',{className:'conflict-compare-card'});
      const cOthers=getOtherPicks(c.id);
      card.appendChild(h('div',{className:'conflict-compare-artist'},artistDisplayName(c,S.currentFestival?.b2bSeparator)));
      card.appendChild(h('div',{className:'conflict-compare-meta'},formatTime(c.startTime)+' - '+formatTime(c.endTime)+' \u00B7 '+getStageName(c.stageId)));
      card.appendChild(h('div',{className:'conflict-compare-crew'},cOthers.length?cOthers.length+' crew going':'No crew'));
      const swapBtn=h('button',{className:'btn btn-ghost btn-sm',type:'button',onclick:(e)=>{e.stopPropagation();savePick(set.id,null);savePick(c.id,getMyPick(set.id)||'want-to-see');S.detailSet=c;render()}},'Switch to this');
      card.appendChild(swapBtn);compare.appendChild(card)
    });
    cw.appendChild(compare);panel.appendChild(cw)
  }

  // Priority picker
  if(S.currentProfile){
    const myPick=getMyPick(set.id);
    const priGroup=h('div',{className:'detail-priority-group'});
    [['must','\u2605','Must See','active-must'],['want-to-see','\u25C6','Want to See','active-want'],['maybe','\u25CF','Maybe','active-maybe'],[null,'\u2715','Clear','active-none']].forEach(([p,icon,label,cls])=>{
      const active=myPick===p;
      const opt=h('button',{className:'detail-priority-option'+(active?' '+cls:''),type:'button','aria-pressed':active?'true':'false','aria-label':label+(active?' (selected)':''),onclick:async(e)=>{e.preventDefault();e.stopPropagation();const btn=e.currentTarget;btn.setAttribute('aria-busy','true');try{await savePick(set.id,p)}finally{btn.removeAttribute('aria-busy')}}});
      opt.appendChild(h('div',{style:{fontSize:'20px'}},icon));opt.appendChild(h('div',{className:'priority-label'},label));priGroup.appendChild(opt)
    });
    panel.appendChild(priGroup);

    // Reminder buttons (only before set starts)
    if(saveReminder&&set.startTime&&!hasSetStarted(set,S.currentFestival)){
      const curReminder=S.currentProfile.reminders?.[set.id]??null;
      const remSection=h('div',{className:'detail-reminder-section'});
      remSection.appendChild(h('div',{className:'detail-reminder-label'},'\uD83D\uDD14 Remind me'));
      const remBtns=h('div',{className:'detail-reminder-btns'});
      [[null,'Off'],[15,'15m'],[30,'30m'],[60,'1h']].forEach(([mins,label])=>{
        const active=curReminder===mins;
        remBtns.appendChild(h('button',{className:'reminder-btn'+(active?' reminder-btn-active':''),type:'button','aria-pressed':active?'true':'false',onclick:()=>saveReminder(set.id,mins)},label))
      });
      remSection.appendChild(remBtns);
      panel.appendChild(remSection)
    }
  } else {
    const joinCta=h('div',{className:'detail-join-cta'});
    joinCta.appendChild(h('p',{},'Join this festival to save picks, keep private notes, and compare crew overlap.'));
    joinCta.appendChild(h('button',{className:'btn btn-primary',type:'button',disabled:S.joinBusy||null,'aria-busy':S.joinBusy?'true':'false',onclick:async()=>{S.detailSet=null;await joinCurrentFestival()}},S.joinBusy?'Joining...':'Join Festival'));
    panel.appendChild(joinCta)
  }

  // Crew overlap
  const others=S.activeCrew?getCrewScopedOtherPicks(set.id):getOtherPicks(set.id);
  const friendsDiv=h('div',{className:'detail-friends'});
  const whoTitle=S.activeCrew?(others.length>0?`${S.activeCrew.name} (${others.length} going)`:`No one in ${S.activeCrew.name} going yet`):(others.length>0?`Who's Going (${others.length})`:'Nobody else going yet');
  friendsDiv.appendChild(h('div',{className:'detail-friends-title'},whoTitle));
  others.forEach(o=>{
    const row=h('div',{className:'detail-friend-item'});
    row.appendChild(createAvatar(o,{size:28,fontSize:11,title:o.name+' ('+o.priority+')'}));
    row.appendChild(h('span',{},o.name));
    const priLabels={must:'Must See','want-to-see':'Want to See',maybe:'Maybe'};
    const priColors={must:'var(--priority-must)','want-to-see':'var(--priority-want)',maybe:'var(--priority-maybe)'};
    row.appendChild(h('span',{className:'friend-priority',style:{color:priColors[o.priority]}},priLabels[o.priority]));
    friendsDiv.appendChild(row)
  });
  const crewNotes=S.allProfiles.filter(p=>p.id!==S.currentProfile?.id&&p.notes?.['crew:'+set.id]).map(p=>({name:p.name,note:p.notes['crew:'+set.id]}));
  if(crewNotes.length>0){
    const crewNotesDiv=h('div',{style:{padding:'8px 0',borderTop:'1px solid var(--border)'}});
    crewNotesDiv.appendChild(h('div',{style:{fontSize:'12px',fontWeight:600,color:'var(--accent-aqua)',marginBottom:'6px'}},'Crew Notes'));
    crewNotes.forEach(cn=>{crewNotesDiv.appendChild(h('div',{style:{fontSize:'13px',padding:'4px 0'}},h('strong',{style:{color:'var(--text-secondary)'}},cn.name+': '),cn.note))});
    friendsDiv.appendChild(crewNotesDiv)
  }
  panel.appendChild(friendsDiv);

  // Notes
  if(S.currentProfile){
    const notesDiv=h('div',{className:'detail-notes'});
    notesDiv.appendChild(h('div',{className:'detail-notes-title',id:'notes-label'},'Personal Notes'));
    const textarea=h('textarea',{placeholder:'Add notes (e.g., "meet at the rail")...','aria-labelledby':'notes-label'});
    textarea.value=getMyNote(set.id)||'';
    textarea.addEventListener('input',(e)=>saveNote(set.id,e.target.value));
    notesDiv.appendChild(textarea);
    const crewNoteKey='crew:'+set.id;const crewNote=S.currentProfile.notes?.[crewNoteKey]||'';
    const crewNotesDiv2=h('div',{className:'detail-notes',style:{marginTop:'8px'}});
    crewNotesDiv2.appendChild(h('div',{className:'detail-notes-title',style:{color:'var(--accent-aqua)'},id:'crew-notes-label'},'Crew Note (visible to your crew)'));
    const crewTextarea=h('textarea',{placeholder:'Share a note with your crew...','aria-labelledby':'crew-notes-label',style:{borderColor:'var(--accent-aqua)',borderWidth:'1px'}});
    crewTextarea.value=crewNote;
    crewTextarea.addEventListener('input',(e)=>saveNote(crewNoteKey,e.target.value));
    crewNotesDiv2.appendChild(crewTextarea);
    notesDiv.appendChild(crewNotesDiv2);
    panel.appendChild(notesDiv)
  }

  overlay.appendChild(panel);
  overlay.addEventListener('modal-close',closeDetail);
  overlay.addEventListener('keydown',(e)=>{if(e.key==='Escape')closeDetail()});
  requestAnimationFrame(()=>{trapFocus(panel);const _fc=panel.querySelector('.detail-close');if(_fc)_fc.focus()});
  return overlay
}
