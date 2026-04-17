/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Crew — selector, create/join, manage, add member
 * Extracted from public/views/crew.js during the 2026-04-14 file-size split.
 * Functions: renderCrewSelector, showCrewCreateJoin, renderCrewManage, openAddMemberOverlay
 */

import { S } from '../../app/state.js?v=1776342458439';
import { $, h } from '../../app/dom.js?v=1776342458439';

export function renderCrewSelector(deps){
  const { selectCrew, createSvgIcon } = deps;
  const strip=h('div',{className:'crew-selector','data-testid':'crew-selector'});
  const allPill=h('button',{className:'crew-pill'+(S.activeCrew===null?' active':''),type:'button','data-testid':'crew-pill-all',onclick:()=>selectCrew(null)});
  allPill.appendChild(h('span',{className:'crew-pill-name'},'All'));
  allPill.appendChild(h('span',{className:'crew-pill-count'},String(S.allProfiles.length)));
  strip.appendChild(allPill);
  S.crews.forEach(crew=>{
    const isActive=S.activeCrew?.id===crew.id;
    const pill=h('button',{className:'crew-pill'+(isActive?' active':''),type:'button','data-testid':'crew-pill','data-crew-id':crew.id,onclick:()=>selectCrew(crew)});
    pill.appendChild(h('span',{className:'crew-pill-name'},crew.name||'Crew'));
    if(crew.role==='owner')pill.appendChild(h('span',{className:'crew-pill-owner'},'★'));
    strip.appendChild(pill);
  });
  const addBtn=h('button',{className:'crew-pill crew-pill-add',type:'button','data-testid':'crew-add-btn',onclick:()=>showCrewCreateJoin(deps)});
  addBtn.appendChild(createSvgIcon('plus',{style:{width:'14px',height:'14px'}}));
  strip.appendChild(addBtn);
  return strip;
}

export function showCrewCreateJoin(deps){
  const { openOverlay, trapFocus, toast, createCrew, joinCrewByCode, render } = deps;
  const existing=$('.crew-action-overlay');if(existing)existing.remove();
  const ov=h('div',{className:'detail-overlay open crew-action-overlay',role:'dialog','aria-modal':'true','aria-label':'Create or join a crew',onclick:(e)=>{if(e.target===ov)closeOv()}});
  const closeOv=openOverlay(ov);
  const panel=h('div',{className:'detail-panel panel-entering crew-action-panel'});
  panel.appendChild(h('button',{className:'detail-close',type:'button','aria-label':'Close crew dialog',onclick:closeOv},'×'));
  panel.appendChild(h('div',{className:'detail-artist'},'Create or Join a Crew'));
  panel.appendChild(h('div',{className:'detail-time',style:{color:'var(--text-secondary)',marginBottom:'20px'}},'Crews let you scope picks and overlap to your group'));
  const createSec=h('div',{className:'crew-action-section'});
  createSec.appendChild(h('h4',{className:'crew-action-title'},'Create a Crew'));
  const createGroup=h('div',{className:'form-group'});
  const nameInput=h('input',{type:'text',className:'input',placeholder:'Crew name (e.g., Bass Squad)',maxlength:'60','aria-label':'Crew name',id:'crewNameInput'});
  createGroup.appendChild(nameInput);
  createSec.appendChild(createGroup);
  createSec.appendChild(h('button',{className:'btn btn-primary',type:'button',style:{marginTop:'12px',width:'100%'},onclick:async()=>{const val=$('#crewNameInput')?.value;if(!val?.trim()){toast('Enter a crew name','error');return}ov.remove();await createCrew(val)}},'Create Crew'));
  panel.appendChild(createSec);
  panel.appendChild(h('div',{className:'crew-action-divider'},h('span',{},'or')));
  const joinSec=h('div',{className:'crew-action-section'});
  joinSec.appendChild(h('h4',{className:'crew-action-title'},'Join with Invite Code'));
  const joinGroup=h('div',{className:'form-group'});
  const codeInput=h('input',{type:'text',className:'input crew-code-input',placeholder:'Enter 6-letter code',maxlength:'12','aria-label':'Invite code',id:'crewCodeInput'});
  codeInput.addEventListener('keydown',(e)=>{if(e.key==='Enter'){const val=$('#crewCodeInput')?.value;if(val?.trim()){ov.remove();joinCrewByCode(val)}}});
  joinGroup.appendChild(codeInput);
  joinSec.appendChild(joinGroup);
  joinSec.appendChild(h('button',{className:'btn btn-primary',type:'button',style:{marginTop:'12px',width:'100%'},onclick:async()=>{const val=$('#crewCodeInput')?.value;if(!val?.trim()){toast('Enter an invite code','error');return}ov.remove();await joinCrewByCode(val)}},'Join Crew'));
  panel.appendChild(joinSec);
  ov.appendChild(panel);ov.addEventListener('keydown',(e)=>{if(e.key==='Escape')ov.remove()});requestAnimationFrame(()=>trapFocus(panel));document.body.appendChild(ov);
}

export function renderCrewManage(deps){
  const { formatRelativeTime, createAvatar, createSvgIcon, createIdentityBadge, toast, render,
          transferCrewOwnership, kickCrewMember, regenerateInviteCode, deleteCrew, updateCrewName, leaveCrew } = deps;
  const crew=S.activeCrew;if(!crew)return h('div');
  const isOwner=crew.role==='owner';
  const container=h('div',{className:'crew-manage','data-testid':'crew-manage'});
  const infoCard=h('div',{className:'crew-manage-card'});
  infoCard.appendChild(h('div',{className:'crew-manage-name'},crew.name));
  infoCard.appendChild(h('div',{className:'crew-manage-meta'},`${S.crewMembers.length} member${S.crewMembers.length!==1?'s':''} · Created ${formatRelativeTime(crew.createdAt)}`));
  if(isOwner&&crew.inviteCode){
    const codeBlock=h('div',{className:'crew-invite-block'});
    codeBlock.appendChild(h('div',{className:'crew-invite-label'},'Invite Code'));
    const codeRow=h('div',{className:'crew-invite-row'});
    const codeValue=h('span',{className:'crew-invite-code','data-testid':'crew-invite-code'},crew.inviteCode);
    codeRow.appendChild(codeValue);
    const copyBtn=h('button',{className:'btn btn-ghost btn-sm',type:'button','aria-label':'Copy invite code',onclick:()=>{navigator.clipboard?.writeText(crew.inviteCode).then(()=>toast('Code copied!','success')).catch(()=>toast('Copy failed','error'))}});
    copyBtn.appendChild(createSvgIcon('copy',{style:{width:'14px',height:'14px'}}));
    copyBtn.appendChild(document.createTextNode(' Copy'));
    codeRow.appendChild(copyBtn);
    codeRow.appendChild(h('button',{className:'btn btn-ghost btn-sm',type:'button',onclick:async()=>{if(confirm('Generate a new invite code? The old one will stop working.'))await regenerateInviteCode(crew.id)}},'Regenerate'));
    codeBlock.appendChild(codeRow);
    if(crew.inviteExpiresAt){
      const exp=new Date(crew.inviteExpiresAt);
      const msDiff=exp-Date.now();
      const daysLeft=Math.ceil(msDiff/864e5);
      const isUrgent=msDiff<172800000; // <2 days
      const expText=msDiff<=0?'Expired':`Expires in ${daysLeft}d`;
      codeBlock.appendChild(h('div',{className:'crew-invite-expiry'+(isUrgent?' crew-invite-expiry-urgent':'')},expText));
    }
    infoCard.appendChild(codeBlock);
  }
  container.appendChild(infoCard);
  const membersSection=h('div',{className:'crew-manage-members'});
  if(S.isAdmin){
    const memberHeader=h('div',{style:'display:flex;align-items:center;justify-content:space-between'});
    memberHeader.appendChild(h('h4',{className:'crew-manage-section-title',style:'margin:0'},'Members'));
    memberHeader.appendChild(h('button',{className:'btn btn-primary btn-sm',type:'button','data-testid':'admin-add-member',onclick:()=>openAddMemberOverlay(deps,crew)},'+ Add'));
    membersSection.appendChild(memberHeader);
  }else{
    membersSection.appendChild(h('h4',{className:'crew-manage-section-title'},'Members'));
  }
  S.crewMembers.forEach(member=>{
    const isMe=member.userId===S.user?.id;
    const isMemberOwner=member.role==='owner';
    const row=h('div',{className:'crew-member-row'+(isMe?' crew-member-self':'')});
    row.appendChild(createAvatar({username:member.username,avatarUrl:member.avatarKey?`/avatars/${member.avatarKey}`:null},{size:32,fontSize:12}));
    const info=h('div',{className:'crew-member-info'});
    info.appendChild(h('div',{className:'crew-member-name'},member.username+(isMe?' (You)':'')));
    const badges=h('div',{className:'crew-member-badges'});
    if(isMemberOwner)badges.appendChild(h('span',{className:'crew-role-badge crew-role-owner'},'Owner'));
    else badges.appendChild(h('span',{className:'crew-role-badge'},'Member'));
    info.appendChild(badges);
    row.appendChild(info);
    if(isOwner&&!isMe){
      const actions=h('div',{className:'crew-member-actions'});
      actions.appendChild(h('button',{className:'btn btn-ghost btn-sm',type:'button',onclick:()=>{if(confirm(`Transfer ownership to ${member.username}?`))transferCrewOwnership(crew.id,member.userId)}},'Make Owner'));
      actions.appendChild(h('button',{className:'btn btn-danger btn-sm',type:'button',onclick:()=>{if(confirm(`Remove ${member.username} from crew?`))kickCrewMember(crew.id,member.userId)}},'Kick'));
      row.appendChild(actions);
    }
    membersSection.appendChild(row);
  });
  container.appendChild(membersSection);
  if(isOwner){
    const ownerSection=h('div',{className:'crew-manage-actions'});
    ownerSection.appendChild(h('h4',{className:'crew-manage-section-title'},'Crew Settings'));
    const renameGroup=h('div',{className:'form-group'});
    renameGroup.appendChild(h('label',{htmlFor:'crewRenameInput'},'Crew Name'));
    const renameRow=h('div',{className:'crew-rename-row'});
    const renameInput=h('input',{type:'text',className:'input',value:crew.name,maxlength:'60',placeholder:'Crew name',id:'crewRenameInput','aria-label':'Rename crew'});
    renameRow.appendChild(renameInput);
    renameRow.appendChild(h('button',{className:'btn btn-primary btn-sm',type:'button',onclick:()=>{const val=$('#crewRenameInput')?.value;if(val?.trim()&&val.trim()!==crew.name)updateCrewName(crew.id,val)}},'Rename'));
    renameGroup.appendChild(renameRow);
    ownerSection.appendChild(renameGroup);
    const dangerZone=h('div',{className:'crew-danger-zone'});
    dangerZone.appendChild(h('div',{className:'crew-danger-label'},'Danger Zone'));
    dangerZone.appendChild(h('button',{className:'btn btn-danger',type:'button',onclick:()=>{if(confirm(`Delete "${crew.name}"? This cannot be undone.`))deleteCrew(crew.id)}},'Delete Crew'));
    ownerSection.appendChild(dangerZone);
    container.appendChild(ownerSection);
  }else{
    const leaveSection=h('div',{className:'crew-manage-actions crew-leave-section'});
    leaveSection.appendChild(h('button',{className:'btn btn-danger',type:'button',style:{width:'100%'},onclick:()=>{if(confirm(`Leave "${crew.name}"?`))leaveCrew(crew.id)}},'Leave Crew'));
    container.appendChild(leaveSection);
  }
  return container;
}

function openAddMemberOverlay(deps, crew) {
  const { openOverlay, trapFocus, toast, render } = deps;
  const existing = document.querySelector('.crew-add-member-overlay');
  if (existing) existing.remove();
  const titleId = 'crew-add-member-title-' + Math.random().toString(36).slice(2, 8);
  const ov = h('div', {
    className: 'detail-overlay open crew-add-member-overlay',
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId,
    onclick: (e) => { if (e.target === ov) closeOv(); },
  });
  const closeOv = openOverlay(ov);
  const panel = h('div', { className: 'detail-panel panel-entering', style: { maxWidth: '400px', padding: '20px' } });
  panel.appendChild(h('button', { className: 'detail-close', type: 'button', 'aria-label': 'Close add member dialog', onclick: closeOv }, '\u00D7'));
  panel.appendChild(h('div', { id: titleId, style: 'font-size:16px;font-weight:600;margin-bottom:4px;color:var(--text-primary)' }, 'Add Member'));
  panel.appendChild(h('div', { style: 'font-size:13px;color:var(--text-secondary);margin-bottom:16px' }, 'Search for a user to add to ' + (crew.name || 'this crew')));

  const searchInput = h('input', {
    type: 'text', className: 'input', placeholder: 'Search by username...',
    style: 'width:100%;margin-bottom:12px', 'aria-label': 'Search users',
  });
  panel.appendChild(searchInput);

  const resultsList = h('div', { className: 'crew-add-results', style: 'max-height:300px;overflow-y:auto' });
  panel.appendChild(resultsList);

  let searchTimer = null;
  const memberIds = new Set(S.crewMembers.map(m => m.userId));

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 1) { resultsList.replaceChildren(); return; }
    searchTimer = setTimeout(async () => {
      try {
        const res = await fetch('/api/v1/crews/search-users?q=' + encodeURIComponent(q), { credentials: 'same-origin' });
        const json = await res.json();
        const users = json.data || json || [];
        resultsList.replaceChildren();
        if (users.length === 0) {
          resultsList.appendChild(h('div', { style: 'padding:12px;color:var(--text-secondary);font-size:13px;text-align:center' }, 'No users found'));
          return;
        }
        users.forEach(u => {
          const isMember = memberIds.has(u.id);
          const row = h('div', {
            className: 'crew-add-result-row',
            style: 'display:flex;align-items:center;justify-content:space-between;padding:10px 8px;border-bottom:1px solid rgba(255,255,255,0.06)',
          });
          row.appendChild(h('span', { style: 'font-size:14px;color:var(--text-primary)' }, u.username));
          if (isMember) {
            row.appendChild(h('span', { style: 'font-size:12px;color:var(--text-secondary)' }, 'Already in crew'));
          } else {
            row.appendChild(h('button', {
              className: 'btn btn-primary btn-sm', type: 'button',
              onclick: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true; btn.textContent = '...';
                try {
                  const resp = await fetch('/api/v1/crews/' + crew.id + '/members', {
                    method: 'POST', credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: u.id }),
                  });
                  const result = await resp.json();
                  if (result.error) throw new Error(result.error);
                  memberIds.add(u.id);
                  btn.textContent = 'Added';
                  btn.style.background = 'var(--accent-green)';
                  S.crewMembers = result.data?.members || S.crewMembers;
                  toast(u.username + ' added to crew', 'success');
                } catch (err) {
                  btn.disabled = false; btn.textContent = 'Add';
                  toast(err.message || 'Failed to add', 'error');
                }
              },
            }, 'Add'));
          }
          resultsList.appendChild(row);
        });
      } catch (err) {
        resultsList.replaceChildren();
        resultsList.appendChild(h('div', { style: 'padding:12px;color:var(--accent-coral);font-size:13px;text-align:center' }, 'Search failed'));
      }
    }, 250);
  });

  ov.appendChild(panel);
  ov.addEventListener('modal-close', () => closeOv());
  document.body.appendChild(ov);
  requestAnimationFrame(() => { searchInput.focus(); trapFocus(panel); });
}
