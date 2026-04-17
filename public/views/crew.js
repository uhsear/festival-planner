/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Crew views — crew shell, selector, conflicts, management, diff modal
 * Extracted from app.js for modularity
 *
 * 2026-04-14 split: this file is now a thin orchestrator + public barrel.
 * Implementations live in ./crew/home-base.js, ./crew/overlap.js, ./crew/list.js.
 */

import { renderPollsTab } from '../app/polls-ui.js?v=1776342458439';
import { S } from '../app/state.js?v=1776342458439';
import { h } from '../app/dom.js?v=1776342458439';
import { renderMeetingPoints, loadMeetingPoints } from './crew/home-base.js?v=1776342458439';
import { renderCrewSchedule, renderCrewConflicts, showCrewDiff } from './crew/overlap.js?v=1776342458439';
import { renderCrewSelector, renderCrewManage, showCrewCreateJoin } from './crew/list.js?v=1776342458439';

export { loadMeetingPoints, showCrewCreateJoin, showCrewDiff };

/**
 * renderCrew — Crew shell with tabs
 * deps: { render, selectCrew, renderGroup, renderAllPicks, createSvgIcon, showCrewCreateJoin,
 *         formatRelativeTime, createAvatar, createIdentityBadge,
 *         getMyPick, getOtherPicks, getCrewScopedOtherPicks, getStageColor, getStageName,
 *         getDays, openOverlay, trapFocus, toast,
 *         createCrew, joinCrewByCode, leaveCrew, kickCrewMember, transferCrewOwnership,
 *         regenerateInviteCode, deleteCrew, updateCrewName, savePick }
 */
export function renderCrew(deps){
  const shell=h('div',{className:'crew-shell',role:'region','aria-label':'Crew'});
  if(!S.user){
    const t=h('div',{className:'guest-teaser'});
    t.appendChild(h('div',{className:'empty-state-icon'},'👥'));
    t.appendChild(h('h2',{style:{margin:'12px 0 8px',fontSize:'18px',color:'var(--text-primary)'}},'Plan with your crew'));
    t.appendChild(h('p',{style:{color:'var(--text-secondary)',fontSize:'14px',maxWidth:'300px',margin:'0 auto 16px'}},'Create a crew, invite friends, compare picks, and find sets you all want to see. Sign up to get started.'));
    t.appendChild(h('button',{className:'btn btn-primary',type:'button',onclick:()=>{S.authMode='register';if(deps.render)deps.render()}},'Sign Up Free'));
    shell.appendChild(t);return shell;
  }
  shell.appendChild(renderCrewSelector(deps));
  if(S.crewLoading){shell.appendChild(h('div',{className:'crew-loading'},'Loading crew...'));return shell}
  const tabs=h('div',{className:'crew-tabs','data-testid':'crew-tabs'});
  const tabItems=[['people','People'],['sets','Sets'],['conflicts','Conflicts'],['schedule','Schedule'],['polls','Polls']];
  // badge counts
  const _openPollsCount = S._openPollsCount || 0;
  if(S.activeCrew)tabItems.push(['expenses','Expenses'],['activity','Activity'],['manage','Crew']);
  tabItems.forEach(([tab,label])=>{
    const tabBtn = h('button',{className:'crew-tab'+(S.crewTab===tab?' active':''),type:'button',onclick:async()=>{
      S.crewTab=tab;
      // Lazy-load expenses and activity only on first visit to those tabs
      if(tab==='expenses'&&S.activeCrew&&!S._crewExpensesLoaded){
        S._crewExpensesLoaded=true;
        deps.loadExpenses?.(S.activeCrew.id).catch(()=>{});
      } else if(tab==='activity'&&S.activeCrew&&!S._crewActivityLoaded){
        S._crewActivityLoaded=true;
        deps.loadActivity?.(S.activeCrew.id).catch(()=>{});
      }
      deps.render()
    }},label);
    if (tab === 'polls' && _openPollsCount > 0) {
      const badge = h('span', { className: 'crew-tab-badge', 'aria-label': _openPollsCount + ' open polls' }, String(_openPollsCount));
      tabBtn.appendChild(badge);
    }
    tabs.appendChild(tabBtn);
  });
  shell.appendChild(tabs);
  if(S.activeCrew){shell.appendChild(renderMeetingPoints(deps,S.activeCrew))}
  if(S.crewTab==='manage'&&S.activeCrew)shell.appendChild(renderCrewManage(deps));
  else if(S.crewTab==='schedule')shell.appendChild(renderCrewSchedule(deps));
  else if(S.crewTab==='conflicts')shell.appendChild(renderCrewConflicts(deps));
  else if(S.crewTab==='expenses'&&deps.renderExpensesTab)shell.appendChild(deps.renderExpensesTab(deps));
  else if(S.crewTab==='activity'&&deps.renderActivityTab)shell.appendChild(deps.renderActivityTab(deps));
  else if(S.crewTab==='polls')shell.appendChild(renderPollsTab(deps));
  else shell.appendChild(S.crewTab==='people'?deps.renderGroup(deps):deps.renderAllPicks(deps));
  return shell;
}
