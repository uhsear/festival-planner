/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Festie Frontend Application
 *
 * Main application coordinator:
 * - Socket.IO real-time listeners + SSE fallback
 * - Offline support (snapshots, sync queue)
 * - View rendering (cards, timeline, picks, crew, admin)
 *
 * Architecture:
 * - S = Proxy-wrapped reactive state (app/state.js)
 * - subscribe() = Watch specific state keys
 * - initRouter() = Hash-based view routing (app/router.js)
 * - Event bus = Decoupled module communication (app/events.js)
 * - render() = Main dispatcher that renders the current view
 * */

import {
  ICON_SPECS,
  PRI_MAP,
  S,
  TRUSTED_MUTATION_HEADER,
  adminState,
  createSocket,
  subscribe,
  stateSet,
  snapshot,
} from './app/state.js?v=1776342458439';
import { $, $$, createSvgIcon as createSvgIconBase, h } from './app/dom.js?v=1776342458439';
import { api as callApi, createAdminApi, getAuthToken } from './app/api.js?v=1776342458439';
import { createToastController } from './app/components/toasts.js?v=1776342458439';
import { registerPushToken, unregisterPushToken } from './app/push.js?v=1776342458439';
import * as offlineQueue from './app/offline-queue.js?v=1776342458439';
import {
  formatTime,
  timeToMinutes,
  getSetHotness,
  getIdentityHash,
  getAvatarColor,
  getInitials,
  normalizeIdentityName,
  artistDisplayName,
} from './app/helpers.js?v=1776342458439';
import { renderTimeline } from './views/timeline.js?v=1776342458439';
import { renderAuthScreen as _renderAuthScreen, renderLoadingOrJoin as _renderLoadingOrJoin, showChangePassword as _showChangePassword, showInstallInstructions as _showInstallInstructions, showChangeEmail as _showChangeEmail } from './views/auth.js?v=1776342458439';
import { renderHeader as _renderHeader, showUserMenu as _showUserMenu, renderSubHeader as _renderSubHeader, renderNoFestival, renderLoadingSkeleton, renderBottomNav as _renderBottomNav } from './views/header.js?v=1776342458439';
import { renderCardGrid as _renderCardGrid } from './views/cards.js?v=1776342458439';
import { renderPicks as _renderPicks, renderGroup as _renderGroup, renderAllPicks as _renderAllPicks } from './views/picks.js?v=1776342458439';
import { renderCrew as _renderCrew, showCrewCreateJoin as _showCrewCreateJoin, showCrewDiff as _showCrewDiff, loadMeetingPoints as _loadMeetingPoints } from './views/crew.js?v=1776342458439';
import { renderGrid as _renderGrid } from './views/grid.js?v=1776342458439';
import { initSpotify } from './app/spotify.js?v=1776342458439';
import { renderDetailPanel as _renderDetailPanel } from './views/detail-panel.js?v=1776342458439';
import { openAdminPanel as _openAdminPanel, renderAdminOverlay as _renderAdminOverlay } from './views/admin/index.js?v=1776342458439';
import { trapFocus, openOverlay, enableTablistKeyboard } from './app/focus.js?v=1776342458439';
import { normalizeIdentityEntity, isCurrentIdentity, getAvatarMeta, createAvatar, createIdentityBadge, getProfileSummary, getOwnProfile, updateIdentityCollections } from './app/identity.js?v=1776342458439';
import { initCrews, loadMyCrews, loadCrewDetails, loadCrewOverlap, selectCrew, createCrew, joinCrewByCode, leaveCrew, kickCrewMember, transferCrewOwnership, regenerateInviteCode, deleteCrew, updateCrewName, getCrewScopedProfiles, getCrewScopedOtherPicks } from './app/crews.js?v=1776342458439';
import * as eventBus from './app/events.js?v=1776342458439';
import { initIOSInstallPrompt, openIOSInstallSheet as _openIOSInstallSheet } from './app/ios-install-prompt.js?v=1776342458439';
import { initRatings, loadMyRatings, loadFestivalRatings, isFestivalOver, renderRatingButtons, renderRatingBadge, renderWrapView } from './app/ratings.js?v=1776342458439';
import { initExpenses, loadExpenses, renderExpensesTab } from './app/expenses.js?v=1776342458439';
import { initActivity, loadActivity, pushActivity, renderActivityTab } from './app/activity.js?v=1776342458439';
import { initFestivalMode, toggleFestivalMode, isFestivalMode, isTodayFestivalDay, renderFestivalView, renderFestivalModeToggle } from './app/festival-mode.js?v=1776342458439';
import { initWeather, loadWeather, renderWeatherWidget, renderHourlyWeather } from './app/weather.js?v=1776342458439';
import { initAuth, checkUserSession, doRegister, doLogin, doForgotPassword, doUserLogout, uploadAvatar, removeAvatar } from './app/auth.js?v=1776342458439';

import { initOffline, readStoredJSON, writeStoredJSON, removeStoredValue, clearLegacyOfflineData, persistOfflineSnapshot, clearOfflineData, hydrateOfflineSnapshot, updatePendingSyncState, queueCurrentProfileSync, clearPendingProfileSync, dropFestivalMembership, removeFestivalFromClientState, mergeCurrentProfile, syncCurrentProfile, scheduleProfileSync, clearProfileSyncTimer, flushPendingProfileSync, sanitizeOfflineProfile } from './app/offline.js?v=1776342458439';
import { initMetrics, trackRender, perfMetrics } from './app/metrics.js?v=1776342458439';
import { initRouter, navigate, guardView } from './app/router.js?v=1776342458439';

const socket=createSocket(getAuthToken());
let _platformHooksInstalled=false;
let _notifPermRequested=false;

// ============= HELPERS =============
function createSvgIcon(name,attrs={}){return createSvgIconBase(name,ICON_SPECS,attrs)}
const api=(path,opts={})=>callApi(path,TRUSTED_MUTATION_HEADER,opts)
const adminApi=createAdminApi(TRUSTED_MUTATION_HEADER)
function getToastContainerWithA11y(){const container=$('#toasts')||document.createElement('div');if(!container.id)container.id='toasts';if(container.className!=='toast-container')container.className='toast-container';if(!container.hasAttribute('aria-live')){container.setAttribute('aria-live','polite');container.setAttribute('role','status')}return container}
const toast=createToastController(h,()=>getToastContainerWithA11y())

initCrews({ api, toast, render: () => render(), socket, getOtherPicks: (setId) => getOtherPicks(setId) });
initOffline({ api, toast, render: () => render() });
initAuth({ api, toast, render: () => render(), refreshRealtimeSession, loadFestivalsAndSelect, persistOfflineSnapshot, clearOfflineData, updateIdentityCollections, registerPushToken, unregisterPushToken, hydrateOfflineSnapshot });
initMetrics();
const spotify = initSpotify();
initRatings({ api, toast, render: () => render() });
initWeather({ api });
initExpenses({ api, toast, render: () => render() });
initActivity({ api, toast, render: () => render(), events: eventBus });
initFestivalMode({ render: () => render(), events: eventBus });

function undoToast(message,undoFn,delay=5000){
  const container=$('#toasts');
  if(!container)return;
  let cancelled=false;
  const el=h('div',{className:'toast toast-undo',style:'background:rgba(20,20,40,.95);border:1px solid var(--border-light)'},
    h('span',{},message),
    h('button',{className:'undo-btn',onclick:()=>{cancelled=true;el.remove();toast('Action undone','info')}},
      'Undo')
  );
  container.appendChild(el);
  setTimeout(()=>{if(!cancelled){el.remove();undoFn()}},delay);
  return()=>{cancelled=true;el.remove()};
}
function socketAuthPayload(){return{userToken:S.userToken||null}}
function joinFestivalRoom(festivalId){if(festivalId)socket.emit('join:festival',festivalId,socketAuthPayload())}
function leaveFestivalRoom(){socket.emit('leave:festival')}
function refreshRealtimeSession(){if(socket.connected)socket.disconnect();socket.connect()}
function getStageColor(id){return S.currentFestival?.stages?.find(s=>s.id===id)?.color||'var(--text-muted)'}
function getStageName(id){return S.currentFestival?.stages?.find(s=>s.id===id)?.name||'Unknown'}
function getMyPick(id){return S.currentProfile?.picks?.[id]||null}
function getMyNote(id){return S.currentProfile?.notes?.[id]||''}
function getOtherPicks(id){return S.allProfiles.filter(p=>p.id!==S.currentProfile?.id&&p.picks?.[id]).map(p=>({name:p.name,avatarUrl:p.avatarUrl||null,priority:p.picks[id],color:getAvatarColor(p.name),initials:getInitials(p.name)}))}
function getDays(){if(!S.currentFestival?.days)return[];return S.currentFestival.days.map((d,i)=>({index:i,label:d.label||d.date,date:d.date,sets:d.sets||[]}))}
function getCurrentDaySets(){return getDays()[S.selectedDay]?.sets||[]}
function filteredSets(){let sets=getCurrentDaySets();if(S.searchQuery){const q=S.searchQuery.toLowerCase();sets=sets.filter(s=>(s.artists?.some(a=>a.name.toLowerCase().includes(q)))||(s.artist||'').toLowerCase().includes(q))}if(S.activeStages.length>0&&S.activeStages.length<(S.currentFestival?.stages?.length||0)){sets=sets.filter(s=>S.activeStages.includes(s.stageId))}return sets}
function getPrimaryViews(){const views=[['cards','Schedule'],['timeline','Timeline'],['grid','Grid']];if(S.currentProfile)views.push(['picks','My Picks'],['crew','Crew']);if(S.currentProfile&&S.currentFestival&&isFestivalOver(S.currentFestival))views.push(['wrap','Wrap']);return views}
function clearFestivalRealtime(){leaveFestivalRoom();stateSet({picksDay:null,detailSet:null,searchQuery:'',crews:[],activeCrew:null,crewOverlap:{},crewMembers:[],crewLoading:false})}
async function loadFestivalContext(festivalId,{joinProfile=false}={}){if(!festivalId){S.currentFestival=null;S.currentProfile=null;S.allProfiles=[];clearFestivalRealtime();return}S.picksDay=null;try{S.currentFestival=await api('/festivals/'+festivalId);S.activeStages=S.currentFestival.stages?.map(s=>s.id)||[];try{S.allProfiles=await api('/profiles/'+festivalId)}catch(e){if(e?.status===403||e?.status===401){S.allProfiles=[]}else throw e}S.currentProfile=getOwnProfile();if(joinProfile&&!S.currentProfile){await api('/profiles',{method:'POST',body:{festivalId}});S.allProfiles=await api('/profiles/'+festivalId);S.currentProfile=getOwnProfile()}if(S.currentProfile){joinFestivalRoom(festivalId)
      await loadMyCrews(festivalId);
      if(S.crews.length>0&&!S.activeCrew){S._crewExpensesLoaded=false;S._crewActivityLoaded=false;await selectCrew(S.crews[0])}
      }else{clearFestivalRealtime()}S.offlineMode=false;persistOfflineSnapshot();
try { S._weatherData = await loadWeather(festivalId); } catch(_wErr) { S._weatherData = null; }
if (S.currentProfile) { try { await loadMyRatings(festivalId); await loadFestivalRatings(festivalId); } catch(_rErr) {} }
const _days=getDays();const _todayIdx=_days.findIndex(d=>dayIsToday(d));if(_todayIdx>=0)S.selectedDay=_todayIdx;
}catch(e){if(!e?.isNetworkError||!hydrateOfflineSnapshot(festivalId))throw e}guardView()}
async function loadFestivalsAndSelect(targetFestivalId=null){try{S.festivals=await api('/festivals')}catch(e){if(!hydrateOfflineSnapshot(targetFestivalId))throw e;render();return}const festId=targetFestivalId||S.festivals[0]?.id;if(!festId){S.currentFestival=null;S.currentProfile=null;S.allProfiles=[];clearFestivalRealtime();return}S.selectedDay=0;await loadFestivalContext(festId)}
async function joinCurrentFestival(){if(!S.currentFestival||S.currentProfile||S.joinBusy)return;S.joinBusy=true;render();try{await loadFestivalContext(S.currentFestival.id,{joinProfile:true});S.joinBusy=false;toast(`Joined ${S.currentFestival.name}`,'success');render()}catch(e){S.joinBusy=false;render();toast(e.message||'Failed to join festival','error')}}

function dayIsToday(day){if(!day?.date)return false;const now=new Date();const yyyy=now.getFullYear();const mm=String(now.getMonth()+1).padStart(2,'0');const dd=String(now.getDate()).padStart(2,'0');return day.date===`${yyyy}-${mm}-${dd}`}
function buildSetDate(day,set){if(!day?.date||!set?.startTime)return null;const stamp=new Date(`${day.date}T${set.startTime}:00`);return Number.isNaN(stamp.getTime())?null:stamp}
function getAllFestivalSets(){return getDays().flatMap((day,dayIndex)=>(day.sets||[]).map(set=>({...set,dayIndex,dayLabel:day.label,date:day.date||'',dayRef:day}))).sort((a,b)=>{if(a.dayIndex!==b.dayIndex)return a.dayIndex-b.dayIndex;const aT=a.startTime||'';const bT=b.startTime||'';if(aT&&bT)return aT.localeCompare(bT);if(aT&&!bT)return -1;if(!aT&&bT)return 1;return(a.artist||'').localeCompare(b.artist||'',undefined,{sensitivity:'base'})})}
function getCurrentOrNextPickedSet(profile=S.currentProfile){if(!profile)return null;const allSets=getAllFestivalSets().filter(set=>profile.picks?.[set.id]);if(allSets.length===0)return null;const _allDays=getDays();if(_allDays.length===0)return null;const safeDay=Math.min(S.selectedDay,_allDays.length-1);const activeDay=_allDays[safeDay];const candidateSets=allSets.filter(set=>set.dayIndex>=safeDay);const filtered=candidateSets.length>0?candidateSets:allSets;const nowMinutes=activeDay&&dayIsToday(activeDay)?(new Date().getHours()*60)+new Date().getMinutes():null;const current=filtered.find(set=>set.dayIndex===safeDay&&set.startTime&&set.endTime&&nowMinutes!==null&&timeToMinutes(set.startTime)<=nowMinutes&&timeToMinutes(set.endTime)>nowMinutes);if(current)return{mode:'Live now',set:current};const nextToday=filtered.find(set=>set.dayIndex===safeDay&&set.startTime&&set.endTime&&(nowMinutes===null||timeToMinutes(set.endTime)>nowMinutes));if(nextToday)return{mode:'Next set',set:nextToday};return filtered.length>0?{mode:'Next set',set:filtered[0]}:null}
function getNextSharedSet(otherProfile){if(!S.currentProfile||!otherProfile)return null;const allSets=getAllFestivalSets().filter(set=>S.currentProfile.picks?.[set.id]&&otherProfile.picks?.[set.id]);return allSets[0]||null}
function formatRelativeTime(iso){if(!iso)return'';const delta=Math.round((Date.now()-new Date(iso).getTime())/60000);if(!Number.isFinite(delta))return'';if(delta<1)return'just now';if(delta<60)return`${delta}m ago`;const hours=Math.round(delta/60);if(hours<24)return`${hours}h ago`;return`${Math.round(hours/24)}d ago`}
function getCrewPulseProfiles(){return S.allProfiles.filter(profile=>profile.id!==S.currentProfile?.id).map(profile=>({...profile,nextSharedSet:getNextSharedSet(profile)})).sort((left,right)=>left.name.localeCompare(right.name))}

// ============= CONFLICT DETECTION =============
function getConflicts(setId){
  if(!S.currentProfile||!S.currentFestival)return[];
  const days=getDays();const allSets=days.flatMap(d=>d.sets||[]);
  const target=allSets.find(s=>s.id===setId);
  if(!target||!getMyPick(setId)||!target.startTime||!target.endTime)return[];
  const tStart=timeToMinutes(target.startTime);let tEnd=timeToMinutes(target.endTime);if(tEnd<=tStart)tEnd+=24*60;
  const targetDay=days.find(d=>(d.sets||[]).some(s=>s.id===setId));
  return allSets.filter(s=>{
    if(s.id===setId||!getMyPick(s.id)||!s.startTime||!s.endTime)return false;
    const sDay=days.find(d=>(d.sets||[]).some(ds=>ds.id===s.id));
    if(sDay!==targetDay)return false;
    if(s.stageId===target.stageId)return false;
    const sStart=timeToMinutes(s.startTime);let sEnd=timeToMinutes(s.endTime);if(sEnd<=sStart)sEnd+=24*60;
    return sStart<tEnd&&tStart<sEnd;
  });
}

// ============= SAVE PICKS / NOTES =============
let _saveTimer=null;
const _savingPicks=new Set();
function savePick(setId,priority){if(!S.currentProfile||_savingPicks.has(setId))return;_savingPicks.add(setId);
  const prevPick=S.currentProfile.picks?.[setId]??null;
  try{const picks={...S.currentProfile.picks};if(priority)picks[setId]=priority;else delete picks[setId];S.currentProfile={...S.currentProfile,picks};mergeCurrentProfile(S.currentProfile);render();clearTimeout(_saveTimer);_saveTimer=setTimeout(()=>scheduleProfileSync(0),300);
  // Undo toast
  const priLabels={must:'Must See','want-to-see':'Want to See',maybe:'Maybe'};
  const label=priority?priLabels[priority]||priority:'Removed';
  toast(label,priority?'success':'info',{action:{label:'Undo',fn:()=>savePick(setId,prevPick)}});
  }finally{setTimeout(()=>_savingPicks.delete(setId),350)}}
let _noteTimer=null;
let _searchDebounce=null;
async function saveNote(setId,note){if(!S.currentProfile)return;const notes={...S.currentProfile.notes};if(note)notes[setId]=note;else delete notes[setId];S.currentProfile={...S.currentProfile,notes};mergeCurrentProfile(S.currentProfile);clearTimeout(_noteTimer);_noteTimer=setTimeout(()=>scheduleProfileSync(0),800)}
let _reminderTimer=null;
async function saveReminder(setId,minutesBefore){
  if(!S.currentProfile)return;
  const reminders={...S.currentProfile.reminders};
  if(minutesBefore!=null)reminders[setId]=minutesBefore;
  else delete reminders[setId];
  S.currentProfile={...S.currentProfile,reminders};
  mergeCurrentProfile(S.currentProfile);
  clearTimeout(_reminderTimer);
  _reminderTimer=setTimeout(()=>scheduleProfileSync(0),400);
  render();
}

// ============= SSE FALLBACK =============
let _sseFallbackTimer=null;
let _sseSource=null;
const SSE_GRACE_MS=30000;

function stopSseFallback(){
  clearTimeout(_sseFallbackTimer);_sseFallbackTimer=null;
  if(_sseSource){_sseSource.close();_sseSource=null;S.sseFallback=false;updateConnectionDot()}
}

function startSseFallback(){
  if(_sseSource||!S.currentFestival)return;
  S.sseFallback=true;updateConnectionDot();
  const festId=S.currentFestival.id;
  const url=`/api/v1/festivals/${encodeURIComponent(festId)}/stream`;
  const es=new EventSource(url,{withCredentials:true});
  _sseSource=es;
  es.addEventListener('festival:updated',async()=>{try{S.currentFestival=await api('/festivals/'+festId);render()}catch(_){console.debug('SSE festival:updated error',_)}});
  es.addEventListener('profile:updated',e=>{try{const d=JSON.parse(e.data);const idx=S.allProfiles.findIndex(p=>p.id===d.profileId);if(idx>=0){S.allProfiles[idx].picks=d.picks??S.allProfiles[idx].picks;render()}}catch(_){console.debug('SSE profile:updated error',_)}});
  es.onerror=()=>{if(es.readyState===EventSource.CLOSED){_sseSource=null;S.sseFallback=false;updateConnectionDot()}};
}

// ============= SOCKET EVENTS =============
socket.on('connect',()=>{S.connected=true;stopSseFallback();if(S.currentFestival&&S.currentProfile)joinFestivalRoom(S.currentFestival.id);updateConnectionDot();offlineQueue.processQueue(api,(event,data,ack)=>socket.emit(event,data,ack),{checkSession:async()=>{try{const r=await api('/auth/me');return!!r?.id}catch{return false}},getProfile:async(festivalId)=>{try{const fid=festivalId||S.currentFestival?.id;if(!fid)return null;const p=await api('/profiles?festivalId='+fid);return p||null}catch{return null}}}).catch(()=>{})});
socket.on('disconnect',()=>{S.connected=false;updateConnectionDot();clearTimeout(_sseFallbackTimer);_sseFallbackTimer=setTimeout(startSseFallback,SSE_GRACE_MS)});
offlineQueue.setStatusCallback((count)=>{S.pendingSync=count>0;updateConnectionDot()});
socket.on('error',(data)=>{if(data?.message)toast(data.message,'error')});
socket.io.on('reconnect',async()=>{S.connected=true;stopSseFallback();updateConnectionDot();flushPendingProfileSync({silent:true}).catch(()=>{});if(S.currentFestival&&S.currentProfile){const lastSeq=0;socket.emit('reconnect:restore',{festivalId:S.currentFestival.id,lastMessageSequence:lastSeq},(res)=>{if(res?.ok){S.currentProfile.id=res.profileId||S.currentProfile.id}});try{const[fest,profs]=await Promise.all([api('/festivals/'+S.currentFestival.id),api('/profiles/'+S.currentFestival.id)]);S.currentFestival=fest;S.allProfiles=profs;const me=profs.find(p=>p.id===S.currentProfile?.id);if(me)S.currentProfile=me;persistOfflineSnapshot();render()}catch(e){console.debug('reconnect state refresh error',e)}
    if(S.activeCrew){socket.emit('join:crew',{crewId:S.activeCrew.id});loadCrewOverlap(S.activeCrew.id).catch(()=>{})}}});
socket.on('profile:updated',(data)=>{if(!data||typeof data!=='object'||!data.profileId)return;if(data.festivalId!==S.currentFestival?.id)return;const isSelf=data.profileId===S.currentProfile?.id;const idx=S.allProfiles.findIndex(p=>p.id===data.profileId);if(idx>=0){S.allProfiles[idx].picks=data.picks;S.allProfiles[idx].avatarUrl=data.avatarUrl??S.allProfiles[idx].avatarUrl;persistOfflineSnapshot();if(!isSelf)render()}});
socket.on('profile:created',(data)=>{if(data.festivalId!==S.currentFestival?.id)return;if(!S.allProfiles.find(p=>p.id===data.profile.id)){S.allProfiles.push({...data.profile,picks:{},notes:{},reminders:{}});persistOfflineSnapshot();render()}});
socket.on('profile:identity',(data)=>{if(data.festivalId!==S.currentFestival?.id)return;updateIdentityCollections(data.username,data.avatarUrl||null,data.profileId||null);if(data.profileId!==S.currentProfile?.id)render()});
socket.on('festival:updated',async(data)=>{if(data?.id===S.currentFestival?.id){try{S.currentFestival=await api('/festivals/'+data.id);persistOfflineSnapshot();render();toast('Schedule updated','info')}catch(e){console.debug('festival:updated error',e)}}});
socket.on('festival:created',async()=>{try{S.festivals=await api('/festivals');render()}catch(e){console.debug('festival:created handler error',e)}});
socket.on('festival:deleted',async(data)=>{removeFestivalFromClientState(data.id);try{S.festivals=await api('/festivals')}catch(e){console.debug('festival:deleted handler error',e)}persistOfflineSnapshot();render()});
socket.on('festival:access-revoked',(data)=>{const festivalId=data?.festivalId;if(!festivalId)return;dropFestivalMembership(festivalId);persistOfflineSnapshot();toast('Crew access for this festival was removed','error');render()});
socket.on('profile:deleted',(data)=>{if(data.festivalId!==S.currentFestival?.id)return;S.allProfiles=S.allProfiles.filter(p=>p.id!==data.profileId);if(S.currentProfile?.id===data.profileId){dropFestivalMembership(data.festivalId);toast('Your festival profile was removed','error')}persistOfflineSnapshot();render()});
socket.on('crew:updated',async(data)=>{if(!data?.id)return;if(S.activeCrew?.id===data.id){if(typeof data.name==='string')S.activeCrew.name=data.name;if(Array.isArray(data.members))S.crewMembers=data.members;await loadMyCrews(S.currentFestival?.id);scheduleRender()}});
socket.on('crew:deleted',(data)=>{if(!data?.crewId)return;if(S.activeCrew?.id===data.crewId){S.activeCrew=null;S.crewOverlap={};S.crewMembers=[];toast('Crew was deleted','info')}S.crews=S.crews.filter(c=>c.id!==data.crewId);scheduleRender()});
socket.on('crew:home-base',(data)=>{if(!data?.crewId)return;if(S.activeCrew?.id===data.crewId){S.activeCrew.homeBaseLocation=data.homeBaseLocation||null;S.activeCrew.homeBaseTime=data.homeBaseTime||null;toast('Home Base updated','info');scheduleRender()}const crew=S.crews.find(c=>c.id===data.crewId);if(crew){crew.homeBaseLocation=data.homeBaseLocation||null;crew.homeBaseTime=data.homeBaseTime||null}});
socket.on('crew:member-joined',async(data)=>{if(!data?.crewId)return;if(S.activeCrew?.id===data.crewId){await loadCrewDetails(data.crewId);await loadCrewOverlap(data.crewId);const who=typeof data.username==='string'?data.username.slice(0,30):'Someone';toast(`${who} joined the crew`,'info');scheduleRender()}});
socket.on('crew:member-left',async(data)=>{if(!data?.crewId)return;if(S.activeCrew?.id===data.crewId){await loadCrewDetails(data.crewId);await loadCrewOverlap(data.crewId);const who=typeof data.username==='string'?data.username.slice(0,30):'Someone';toast(`${who} left the crew`,'info');scheduleRender()}});
socket.on('crew:member-kicked',async(data)=>{if(!data?.crewId)return;if(data.userId===S.user?.id){if(S.activeCrew?.id===data.crewId){S.activeCrew=null;S.crewOverlap={};S.crewMembers=[]}S.crews=S.crews.filter(c=>c.id!==data.crewId);toast('You were removed from a crew','error');scheduleRender();return}if(S.activeCrew?.id===data.crewId){await loadCrewDetails(data.crewId);await loadCrewOverlap(data.crewId);scheduleRender()}});

function updateConnectionDot(){const d=$('.conn-status');if(d){const cls=S.connected?'connected':S.sseFallback?'fallback':'disconnected';d.className='conn-status '+cls;d.setAttribute('aria-label',S.connected?'Connected':S.sseFallback?'Reconnecting (fallback)':'Disconnected')}}

// ============= NOW & NEXT STRIP =============
// ============= FESTIVAL COUNTDOWN =============
function renderCountdown(){
  if(!S.currentFestival)return null;
  const days=S.currentFestival.days||[];if(days.length===0)return null;
  const firstDate=days[0]?.date;const lastDate=days[days.length-1]?.date;
  if(!firstDate)return null;
  const now=new Date();const start=new Date(firstDate+'T00:00:00');const end=lastDate?new Date(lastDate+'T23:59:59'):start;
  const msToStart=start-now;const msToEnd=end-now;
  if(msToEnd<0)return null;
  const strip=h('div',{className:'countdown-strip'});
  if(msToStart>0){
    const daysLeft=Math.ceil(msToStart/(1000*60*60*24));
    const label=daysLeft===1?'Starts tomorrow!':daysLeft<=7?`${daysLeft} days away`:`${daysLeft} days until ${S.currentFestival.name}`;
    strip.appendChild(h('span',{className:'countdown-label'},label));
    strip.appendChild(h('span',{className:'countdown-date'},`${firstDate}${lastDate&&lastDate!==firstDate?' — '+lastDate:''}`));
  }else{
    const dayIdx=days.findIndex(d=>{const dd=new Date(d.date+'T00:00:00');return dd.toDateString()===now.toDateString()});
    if(dayIdx>=0){strip.className='countdown-strip countdown-live';strip.appendChild(h('span',{className:'countdown-label'},`Day ${dayIdx+1} — Live Now`));strip.appendChild(h('span',{className:'countdown-date'},days[dayIdx].label||days[dayIdx].date))}
    else{strip.appendChild(h('span',{className:'countdown-label'},'Festival in progress'));strip.appendChild(h('span',{className:'countdown-date'},`${firstDate} — ${lastDate}`))}}
  return strip;
}

// ============= WHO'S GOING OVERLAY =============
function showWhosGoing(setId,setArtist){
  const others=S.activeCrew?getCrewScopedOtherPicks(setId):getOtherPicks(setId);
  if(others.length===0)return;
  const ov=h('div',{className:'detail-overlay open',onclick:(e)=>{if(e.target===ov)closeOv()}});
  const closeOv=openOverlay(ov);
  const panel=h('div',{className:'detail-panel',style:{maxWidth:'400px'}});
  panel.appendChild(h('button',{className:'detail-close','aria-label':'Close crew panel',type:'button',onclick:closeOv},'×'));
  panel.appendChild(h('div',{className:'detail-artist'},'Who\'s Going'));
  panel.appendChild(h('div',{className:'detail-time'},setArtist));
  const list=h('div',{style:{padding:'12px 0'}});
  others.forEach(o=>{
    const row=h('div',{style:{display:'flex',alignItems:'center',gap:'10px',padding:'8px 0',borderBottom:'1px solid var(--border)'}});
    row.appendChild(createAvatar(o,{size:32,fontSize:12}));
    const info=h('div',{style:{flex:1}});
    info.appendChild(h('div',{style:{fontWeight:600,fontSize:'14px'}},o.name));
    const priLabel={must:'Must See','want-to-see':'Want to See',maybe:'Maybe'}[o.priority]||o.priority;
    const priColor={must:'var(--priority-must)','want-to-see':'var(--priority-want)',maybe:'var(--priority-maybe)'}[o.priority]||'var(--text-muted)';
    info.appendChild(h('div',{style:{fontSize:'12px',color:priColor,fontWeight:500}},priLabel));
    row.appendChild(info);
    if(S.currentProfile&&!getMyPick(setId)){
      row.appendChild(h('button',{className:'btn btn-ghost btn-sm',type:'button',style:{fontSize:'11px'},onclick:(e)=>{e.stopPropagation();savePick(setId,o.priority);ov.remove();toast('Added to your picks!','success')}},'+ Me too'));
    }
    list.appendChild(row);
  });
  panel.appendChild(list);
  ov.appendChild(panel);document.body.appendChild(ov);
}

// ============= THEME TOGGLE =============
function getTheme(){return localStorage.getItem('fp-theme')||'dark'}
function setTheme(theme){localStorage.setItem('fp-theme',theme);document.documentElement.setAttribute('data-theme',theme)}
function toggleTheme(){const next=getTheme()==='dark'?'light':'dark';setTheme(next);render()}

// ============= LINEUP DIFF =============
function checkLineupDiff(){
  if(!S.currentFestival)return null;
  const key=`fp-lineup-hash:${S.currentFestival.id}`;
  const allSets=(S.currentFestival.days||[]).flatMap(d=>(d.sets||[]).map(s=>s.id+':'+artistDisplayName(s,S.currentFestival.b2bSeparator)+':'+s.startTime));
  const currentHash=allSets.sort().join('|');
  const prevHash=localStorage.getItem(key);
  if(!prevHash){localStorage.setItem(key,currentHash);return null}
  if(prevHash===currentHash)return null;
  const prevSet=new Set(prevHash.split('|'));const currSet=new Set(currentHash.split('|'));
  const added=allSets.filter(s=>!prevSet.has(s)).length;
  const removed=[...prevSet].filter(s=>!currSet.has(s)).length;
  return{added,removed,dismiss:()=>{localStorage.setItem(key,currentHash)}}
}

function renderLineupDiffBanner(){
  const diff=checkLineupDiff();
  if(!diff)return null;
  const banner=h('div',{className:'lineup-diff-banner'});
  const parts=[];
  if(diff.added>0)parts.push(`${diff.added} set${diff.added>1?'s':''} added`);
  if(diff.removed>0)parts.push(`${diff.removed} set${diff.removed>1?'s':''} changed/removed`);
  banner.appendChild(h('span',{},'Lineup updated: '+parts.join(', ')));
  banner.appendChild(h('button',{className:'btn btn-ghost btn-sm',type:'button',onclick:()=>{diff.dismiss();render()}},'Dismiss'));
  return banner;
}

function renderNowNext(){
  if(!S.currentProfile||!S.currentFestival)return null;
  const result=getCurrentOrNextPickedSet();
  if(!result)return null;
  const {mode,set}=result;
  if(!set)return null;
  const sc=getStageColor(set.stageId);
  const sn=getStageName(set.stageId);
  const strip=h('div',{className:'now-next-strip',onclick:()=>{S.detailSet=set;render()}});
  const badge=h('span',{className:'now-next-badge'+(mode==='Live now'?' now-next-live':'')},mode);
  strip.appendChild(badge);
  strip.appendChild(h('span',{className:'now-next-artist'},artistDisplayName(set,S.currentFestival?.b2bSeparator)));
  strip.appendChild(h('span',{className:'now-next-time'},formatTime(set.startTime)+' - '+formatTime(set.endTime)));
  strip.appendChild(h('span',{className:'now-next-stage',style:{color:sc}},sn));
  return strip;
}
// ============= RENDER =============
function renderJoinCallout(){const totalSets=(S.currentFestival?.days||[]).reduce((count,day)=>count+((day.sets||[]).length),0);const callout=h('section',{className:'join-callout','data-testid':'join-callout'});const copy=h('div',{className:'join-callout-copy'});copy.appendChild(h('span',{className:'join-callout-kicker'},'Festival profile required'));copy.appendChild(h('h3',{},`Join ${S.currentFestival?.name||'this festival'} to save your plan`));copy.appendChild(h('p',{},'Joining creates a festival-specific profile so you can save picks, keep private notes, compare crew plans, and coordinate in real time. Your account photo and password stay account-wide.'));const actions=h('div',{className:'join-callout-actions'});actions.appendChild(h('button',{className:'btn btn-primary',type:'button',disabled:S.joinBusy||null,'data-testid':'join-festival-button',onclick:joinCurrentFestival},S.joinBusy?'Joining...':'Join Festival'));actions.appendChild(h('span',{className:'join-inline-note'},'You can still browse the schedule before joining.'));copy.appendChild(actions);callout.appendChild(copy);const stats=h('div',{className:'join-callout-stats'});[[totalSets,'Sets'],[S.currentFestival?.stages?.length||0,'Stages'],[S.currentFestival?.days?.length||0,'Days']].forEach(([value,label])=>{const stat=h('div',{className:'join-callout-stat'});stat.appendChild(h('strong',{},String(value)));stat.appendChild(h('span',{},label));stats.appendChild(stat)});callout.appendChild(stats);return callout}
function renderOfflineBanner(){const banner=h('div',{className:'offline-banner','data-testid':'offline-banner',role:'status','aria-live':'polite','aria-atomic':'true'});banner.appendChild(h('div',{},S.offlineMode?'Offline mode enabled. ':'Sync pending. ',h('span',{},S.offlineMode?'Your own schedule stays available here. Live presence and other profiles come back when you reconnect.':'Your latest festival changes still need to sync.')));if(S.pendingSync&&!S.offlineMode)banner.appendChild(h('button',{className:'btn btn-ghost btn-sm',type:'button',onclick:()=>flushPendingProfileSync().catch(()=>{})},'Sync now'));return banner}
function renderFestivalModeDayBanner() {
  // Show a subtle prompt when it's a festival day but festival mode is off
  if (!S.currentFestival || !S.currentProfile || isFestivalMode()) return null;
  if (!isTodayFestivalDay()) return null;
  // Suppress for this session if user dismissed it
  if (sessionStorage.getItem('festie-fm-banner-dismissed') === '1') return null;
  const banner = h('div', { className: 'festival-mode-day-banner', role: 'status' });
  banner.appendChild(h('span', { className: 'fm-day-banner-text' }, "⚡ It’s festival day — activate Festival Mode for Now/Next view"));
  const actions = h('div', { className: 'fm-day-banner-actions' });
  actions.appendChild(h('button', {
    className: 'btn btn-primary btn-sm fm-day-banner-activate',
    type: 'button',
    onclick: () => { toggleFestivalMode(); render(); }
  }, 'Activate'));
  actions.appendChild(h('button', {
    className: 'btn btn-ghost btn-sm fm-day-banner-dismiss',
    type: 'button',
    'aria-label': 'Dismiss',
    onclick: () => { sessionStorage.setItem('festie-fm-banner-dismissed', '1'); render(); }
  }, '✕'));
  banner.appendChild(actions);
  return banner;
}

let _renderFrame=null;
let _lastRenderedView=null;let _lastDetailOpen=false;let _viewChanged=false;let _isRendering=false;
let _lastRenderTime=0;const _MIN_RENDER_INTERVAL=16;
function scheduleRender(){if(_renderFrame)return;const now=performance.now();const elapsed=now-_lastRenderTime;if(elapsed<_MIN_RENDER_INTERVAL){_renderFrame=setTimeout(()=>{_renderFrame=null;_lastRenderTime=performance.now();render()},_MIN_RENDER_INTERVAL-elapsed);return}_renderFrame=requestAnimationFrame(()=>{_renderFrame=null;_lastRenderTime=performance.now();render()})}
function render(){if(_isRendering){scheduleRender();return}_isRendering=true;try{_viewChanged=_lastRenderedView!==S.view;if(_viewChanged){S.searchQuery='';S.activeStages=[]}const detailOpening=!!S.detailSet&&!_lastDetailOpen;const prevScrollTop=_viewChanged?0:(document.querySelector('.content-area')?.scrollTop||0);_lastRenderedView=S.view;_lastDetailOpen=!!S.detailSet;const app=$('#app');app.replaceChildren();
if(!S.user&&!S.currentFestival){renderAuthScreen(app);return}
app.appendChild(renderHeader());const main=h('div',{className:'main-content','data-view':S.view});if(S.offlineMode||S.pendingSync)main.appendChild(renderOfflineBanner());
const diffBanner=renderLineupDiffBanner();if(diffBanner)main.appendChild(diffBanner);
const countdown=renderCountdown();if(countdown)main.appendChild(countdown);
main.appendChild(renderSubHeader());
const nowNext=renderNowNext();if(nowNext)main.appendChild(nowNext);
const fmBanner=renderFestivalModeDayBanner();if(fmBanner)main.appendChild(fmBanner);
if(S._weatherData&&S._weatherData.available){const ww=renderWeatherWidget(S._weatherData);if(ww)main.appendChild(ww)}
const content=h('main',{className:'content-area'+(_viewChanged?' view-switching':''),id:'main-content'});
if(!S.user){const guestBanner=h('div',{className:'guest-banner'});guestBanner.appendChild(h('span',{},'Browsing as guest.'));guestBanner.appendChild(h('button',{className:'btn btn-primary btn-sm',type:'button',onclick:()=>{S.currentFestival=null;S.festivals=[];render()}},'Login / Sign Up'));content.appendChild(guestBanner)}
if(!S.currentFestival)content.appendChild(renderNoFestival());
else{
if(S.user&&!S.currentProfile)content.appendChild(renderJoinCallout());
if(isFestivalMode()){content.appendChild(renderFestivalView())}
else if(S.view==='timeline')content.appendChild(renderTimeline({filteredSets,getDays,getMyPick,getOtherPicks,createAvatar,savePick,render,dayIsToday}));
else if(S.view==='grid')content.appendChild(renderGrid());
else if(S.view==='cards')content.appendChild(renderCardGrid());
else if(S.view==='picks')content.appendChild(renderPicks());
else if(S.view==='crew')content.appendChild(renderCrew());
else content.appendChild(renderCardGrid())
}
main.appendChild(content);app.appendChild(main);if(prevScrollTop>0)content.scrollTop=prevScrollTop;
if(window.innerWidth<=768){let _lastScroll=0;content.addEventListener('scroll',()=>{const st=content.scrollTop;const delta=st-_lastScroll;if(st>24&&delta>2)main.classList.add('sub-header-collapsed');else if(delta<-4||st<=8)main.classList.remove('sub-header-collapsed');_lastScroll=st},{passive:true})}
app.appendChild(renderBottomNav());
if(S.detailSet){const dp=renderDetailPanel(S.detailSet);if(detailOpening){dp.querySelector('.detail-panel')?.classList.add('panel-entering');requestAnimationFrame(()=>{const closeBtn=dp.querySelector('.detail-close');if(closeBtn)closeBtn.focus()})}app.appendChild(dp)}

if(S.searchQuery){const si=$('.search-box input');if(si&&document.activeElement!==si){si.focus();si.selectionStart=si.selectionEnd=si.value.length}}}catch(err){console.error('RENDER CRASH:',err);const app=document.getElementById('app');if(app){app.replaceChildren();const errorContainer=h('div',{className:'error-boundary'},h('h2',{},'Something went wrong'),h('p',{},'Try refreshing the page.'),h('button',{className:'error-boundary-btn',onclick:()=>{location.reload()}},'Reload'));app.appendChild(errorContainer)}}finally{restoreSearchFocus();_isRendering=false}}

// ============= VIEW DELEGATES =============
function renderAuthScreen(container){_renderAuthScreen(container,{doLogin,doRegister,doForgotPassword,render})}
function renderLoadingOrJoin(container){_renderLoadingOrJoin(container)}
function renderHeader(){return _renderHeader({getPrimaryViews,enableTablistKeyboard,createAvatar,createSvgIcon,openAdminPanel,showUserMenu,navigate,toggleTheme,getTheme,showInstallInstructions,render,toast,toggleFestivalMode,isFestivalMode,renderFestivalModeToggle})}
function showUserMenu(){_showUserMenu({getProfileSummary,getAvatarMeta,createAvatar,createIdentityBadge,showChangePassword,showChangeEmail,uploadAvatar,removeAvatar,openAdminPanel,doUserLogout,api,toast,render,joinCurrentFestival})}
function showChangePassword(){_showChangePassword({api,toast,trapFocus,refreshRealtimeSession})}
function showInstallInstructions(){_showInstallInstructions({trapFocus})}
function showChangeEmail(){_showChangeEmail({api,toast,trapFocus})}
async function doExport(){if(!S.currentFestival||!S.currentProfile)return;try{if(!navigator.onLine)throw new Error('Reconnect to export your latest schedule');clearProfileSyncTimer();await syncCurrentProfile();const resp=await fetch(`/api/v1/export/${S.currentFestival.id}/${S.currentProfile.id}`,{credentials:'same-origin'});if(!resp.ok){const err=await resp.json().catch(()=>({error:'Export failed'}));throw new Error(err.error||'Export failed')}const html=await resp.text();doExportPdf(html)}catch(e){toast(e.message||'Export failed','error')}}
async function doExportCalendar(){if(!S.currentFestival||!S.currentProfile)return;try{if(!navigator.onLine)throw new Error('Reconnect to export');clearProfileSyncTimer();await syncCurrentProfile();const resp=await fetch(`/api/v1/export/${S.currentFestival.id}/${S.currentProfile.id}/calendar`,{credentials:'same-origin'});if(!resp.ok){const err=await resp.json().catch(()=>({error:'Calendar export failed'}));throw new Error(err.error||'Failed')}const blob=await resp.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${S.currentFestival.name.replace(/[^a-z0-9_-]/gi,'_')}_schedule.ics`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Calendar file downloaded! Import it into Google Calendar, Apple Calendar, or Outlook.','success')}catch(e){toast(e.message||'Calendar export failed','error')}}
function doExportPdf(html){const iframe=document.createElement('iframe');iframe.style.cssText='position:fixed;left:-9999px;top:-9999px;width:800px;height:1200px';document.body.appendChild(iframe);iframe.contentDocument.open();iframe.contentDocument.write(html+'<scr'+'ipt>window.onafterprint=function(){parent.postMessage("pdf-done","*")}<'+'/script>');iframe.contentDocument.close();const cleanup=()=>{iframe.remove();window.removeEventListener('message',onMsg)};const onMsg=(e)=>{if(e.data==='pdf-done')cleanup()};window.addEventListener('message',onMsg);setTimeout(()=>{try{iframe.contentWindow.print()}catch(e){toast('Print dialog failed. Try right-click > Print on the downloaded HTML instead.','error');cleanup()}},500);setTimeout(cleanup,60000)}
function renderSubHeader(){return _renderSubHeader({getDays,createSvgIcon,loadFestivalContext,toast,render,enableTablistKeyboard})}
function renderCardGrid(){return _renderCardGrid({filteredSets,getMyPick,getOtherPicks,getCrewScopedOtherPicks,getMyNote,getStageColor,getStageName,getConflicts,savePick,showWhosGoing,createAvatar,render,_viewChanged,spotify})}
function renderGrid(){return _renderGrid({getDays,getStages:()=>S.currentFestival?.stages||[],filteredSets,getMyPick,getStageColor,getStageName,getConflicts,render,S})}
function renderPicks(){return _renderPicks({getDays,getMyPick,getMyNote,getStageColor,getStageName,getOtherPicks,getConflicts,savePick,createAvatar,render,doExport,doExportCalendar,toast,_viewChanged})}
function renderGroup(){return _renderGroup({getDays,getMyPick,getOtherPicks,getCrewScopedProfiles,createAvatar,savePick,render,toast,showCrewDiff,createIdentityBadge,_viewChanged})}
function renderAllPicks(){return _renderAllPicks({getDays,getCrewScopedProfiles,getStageColor,getStageName,createAvatar,render})}
function renderCrew(){return _renderCrew({render,selectCrew,renderGroup,renderAllPicks,createSvgIcon,showCrewCreateJoin,formatRelativeTime,createAvatar,createIdentityBadge,getMyPick,getOtherPicks,getCrewScopedOtherPicks,getStageColor,getStageName,getDays,openOverlay,trapFocus,toast,createCrew,joinCrewByCode,leaveCrew,kickCrewMember,transferCrewOwnership,regenerateInviteCode,deleteCrew,updateCrewName,savePick,renderExpensesTab:(d)=>renderExpensesTab({crewId:S.activeCrew?.id,crewMembers:S.crewMembers||[],currentUserId:S.user?.id}),renderActivityTab:(d)=>renderActivityTab({crewId:S.activeCrew?.id}),loadExpenses,loadActivity})}
function showCrewCreateJoin(deps){_showCrewCreateJoin(deps)}
function showCrewDiff(otherProfile){_showCrewDiff(otherProfile,{getDays,getMyPick,getStageColor,getStageName,createAvatar,createIdentityBadge,openOverlay,trapFocus})}
function getDayLabel(setId){const days=getDays();return days.find(d=>(d.sets||[]).some(s=>s.id===setId))?.label||''}
function formatTimestamp(iso){try{const d=new Date(iso);let hr=d.getHours();const mm=String(d.getMinutes()).padStart(2,'0');const ap=hr>=12?'PM':'AM';hr=hr%12||12;return`${hr}:${mm} ${ap}`}catch(e){return''}}
function formatDateLabel(iso){try{if(!iso)return'';const d=new Date(iso);if(isNaN(d.getTime()))return'';const now=new Date();const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());const msgDay=new Date(d.getFullYear(),d.getMonth(),d.getDate());const diff=Math.round((today-msgDay)/(1000*60*60*24));if(diff===0)return'Today';if(diff===1)return'Yesterday';return d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}catch(e){return''}}
function renderDetailPanel(set){return _renderDetailPanel(set,{getMyPick,getOtherPicks,getCrewScopedOtherPicks,getStageColor,getStageName,getConflicts,getMyNote,savePick,saveNote,saveReminder,createAvatar,render,trapFocus,joinCurrentFestival,spotify})}
function renderBottomNav(){return _renderBottomNav({getPrimaryViews,enableTablistKeyboard,createSvgIcon,navigate,render})}
function openAdminPanel(){_openAdminPanel({api,adminApi,toast,render,trapFocus})}
function renderAdminOverlay(){_renderAdminOverlay({api,adminApi,toast,render,trapFocus})}

function warmFestivalCache(festivalId){if(!('serviceWorker'in navigator)||!navigator.serviceWorker.controller)return;navigator.serviceWorker.controller.postMessage({type:'CACHE_FESTIVAL',endpoints:['/api/v1/festivals/'+festivalId,'/api/v1/festivals/'+festivalId+'/sets','/api/v1/profiles/'+festivalId,'/api/v1/crews?festival='+festivalId]})}

async function registerPlatformFeatures(){if(_platformHooksInstalled)return;_platformHooksInstalled=true;if('serviceWorker'in navigator){try{await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});S.serviceWorkerReady=true;navigator.serviceWorker.addEventListener('message',(event)=>{const msg=event.data;if(!msg||typeof msg!=='object')return;if(msg.type==='silent:sync'&&S.currentFestival){if(msg.syncType==='profiles'&&msg.festivalId===S.currentFestival.id)api('/profiles/'+S.currentFestival.id).then(profs=>{S.allProfiles=profs;const me=profs.find(p=>p.id===S.currentProfile?.id);if(me)S.currentProfile=me;persistOfflineSnapshot();render()}).catch(()=>{});if(msg.syncType==='festival'&&msg.festivalId===S.currentFestival.id)api('/festivals/'+S.currentFestival.id).then(fest=>{S.currentFestival=fest;persistOfflineSnapshot();render()}).catch(()=>{})}if(msg.type==='notification:click'&&msg.festivalId&&msg.festivalId!==S.currentFestival?.id)loadFestivalContext(msg.festivalId).then(()=>render()).catch(()=>{});if(msg.type==='sw:updated'){const t=h('div',{className:'toast toast-update',role:'alert','aria-live':'assertive',style:'background:rgba(20,20,40,.95);border:1px solid var(--accent-aqua);cursor:pointer',onclick:(e)=>{if(!e.target.classList.contains('toast-dismiss'))location.reload()}},h('span',{},'New version available \u2014 tap to refresh'),h('button',{className:'toast-dismiss',type:'button','aria-label':'Dismiss update notice',onclick:(e)=>{e.stopPropagation();t.remove()}},'\u00D7'));document.getElementById('toasts')?.appendChild(t);setTimeout(()=>t.remove(),30000)}})}catch(e){console.debug('SW registration error',e)}}window.addEventListener('beforeinstallprompt',(event)=>{event.preventDefault();S.installPromptEvent=event;S.canInstall=true;try{navigator.sendBeacon&&navigator.sendBeacon('/api/v1/analytics/install',new Blob([JSON.stringify({platform:'android',event:'native_fired'})],{type:'application/json'}))}catch(_){}render()});window.addEventListener('appinstalled',()=>{S.appInstalled=true;S.canInstall=false;S.installPromptEvent=null;toast('Festie installed','success');render()});window.addEventListener('online',()=>{S.offlineMode=false;toast('Back online','success');flushPendingProfileSync().catch(()=>{});if(S.currentFestival?.id){loadFestivalContext(S.currentFestival.id).then(()=>{warmFestivalCache(S.currentFestival.id);render()}).catch(()=>render())}else render()});window.addEventListener('offline',()=>{S.offlineMode=true;toast('Offline \u2014 using cached data','info');render()})}

function restoreSearchFocus(){if(S.searchQuery){const searchInput=document.querySelector('.search-input');if(searchInput){searchInput.focus();searchInput.selectionStart=searchInput.selectionEnd=searchInput.value.length}}}

// ============= INIT =============
document.addEventListener('keydown',(e)=>{
  if(e.key==='Escape'){
    if(S.detailSet){const dp=document.querySelector('.detail-panel');if(dp){dp.classList.add('panel-exiting');dp.addEventListener('animationend',()=>{S.detailSet=null;S.detailSetTrigger=null;render()},{once:true})}else{S.detailSet=null;render()}return}
    if(adminState.open){adminState.open=false;render();return}
  }
});

async function init(){
  await registerPlatformFeatures();
  initRouter(() => render());
  try{S.festivals=await api('/festivals')}catch(e){S.offlineMode=true;hydrateOfflineSnapshot();if(!S.festivals||!S.festivals.length){toast('You\u2019re offline \u2014 no cached festivals yet. Reconnect to load.','info');}}
  const urlParams=new URLSearchParams(window.location.search);
  const sharedFest=urlParams.get('festival');
  const joinCrewCode=urlParams.get('joinCrew');
  setTheme(getTheme());
  const hasUser=await checkUserSession();
  if(S.festivals.length>0){try{S.selectedDay=0;await loadFestivalContext(sharedFest||S.festivals[0].id)}catch(e){console.debug('init loadFestivalContext error',e)}}
  if(S.festivals.length===1&&!S.currentFestival){await loadFestivalContext(S.festivals[0].id)}
  if(hasUser){
    registerPushToken(api,(payload)=>{
      const title=payload.notification?.title||'Festie';
      const body=payload.notification?.body||'';
      toast(`${title}: ${body}`,'info');
    }).catch(()=>{});
  }
  if(joinCrewCode&&hasUser){
    try{
      const joinResult=await api('/crews/join',{method:'POST',body:{inviteCode:joinCrewCode}});
      if(joinResult?.id){toast('Joined crew!','success');window.history.replaceState({},'',window.location.pathname)}
    }catch(e){if(e.message&&!e.message.includes('Already'))toast('Could not join crew: '+e.message,'error')}
  }
  updatePendingSyncState();
  // Persist whatever we got so the next boot can render instantly even
  // offline. persistOfflineSnapshot is now guest-friendly — it saves the
  // festivals list + current festival structure regardless of S.user.
  try { persistOfflineSnapshot(); } catch(_) {}
  render();
  // iOS install sheet — waits for engagement, respects dismissal cooldown
  try { initIOSInstallPrompt(); } catch(_) {}
  window.fpShowInstall = () => { try { _showInstallInstructions() } catch(_) {} };
}
init();
