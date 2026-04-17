/**
 * Schedule Share — Festie
 * Generates a client-side Canvas PNG of the user's picks in dark glassmorphism style
 * for sharing to social media.
 */
import { S } from './state.js?v=1776342458439';
import { formatTime, artistDisplayName } from './helpers.js?v=1776342458439';

const CANVAS_W = 1080;
const CANVAS_H = 1920;
const CARD_RADIUS = 18;
const PRIORITY_COLORS = {
  must: '#FFD700',
  'want-to-see': '#00D4AA',
  maybe: '#9B72FF',
};
const PRIORITY_LABELS = { must: 'Must See', 'want-to-see': 'Want to See', maybe: 'Maybe' };
const BG_TOP = '#0a0a14';
const BG_MID = '#0d1528';
const GLASS = 'rgba(255,255,255,0.05)';
const TEXT_PRI = '#ffffff';
const TEXT_SEC = 'rgba(255,255,255,0.65)';
const ACCENT = '#00D4AA';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export async function generateScheduleImage() {
  const picks = S.currentProfile?.picks || {};
  const festival = S.currentFestival;
  if (!festival) throw new Error('No festival selected');

  const allSets = (festival.days || []).flatMap(d => d.sets || []);
  const myPickSets = allSets
    .filter(s => picks[s.id] && picks[s.id] !== null)
    .sort((a, b) => {
      const dayA = (festival.days || []).findIndex(d => (d.sets || []).some(s => s.id === a.id));
      const dayB = (festival.days || []).findIndex(d => (d.sets || []).some(s => s.id === b.id));
      if (dayA !== dayB) return dayA - dayB;
      return (a.startTime || '').localeCompare(b.startTime || '');
    });

  if (myPickSets.length === 0) throw new Error('No picks to share yet');

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  // Background gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  bgGrad.addColorStop(0, BG_TOP);
  bgGrad.addColorStop(1, BG_MID);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Subtle radial glow
  const glow = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H * 0.2, 0, CANVAS_W / 2, CANVAS_H * 0.2, CANVAS_W * 0.8);
  glow.addColorStop(0, 'rgba(0,212,170,0.08)');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Header
  ctx.fillStyle = ACCENT;
  ctx.font = 'bold 68px "Space Grotesk", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('my lineup', CANVAS_W / 2, 120);

  ctx.fillStyle = TEXT_SEC;
  ctx.font = '36px "Space Grotesk", system-ui, sans-serif';
  ctx.fillText(festival.name || '', CANVAS_W / 2, 175);

  // User display name
  const username = S.user?.username || '';
  if (username) {
    ctx.fillStyle = TEXT_SEC;
    ctx.font = '30px "Space Grotesk", system-ui, sans-serif';
    ctx.fillText('@' + username, CANVAS_W / 2, 218);
  }

  // Divider
  ctx.strokeStyle = 'rgba(0,212,170,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(80, 248);
  ctx.lineTo(CANVAS_W - 80, 248);
  ctx.stroke();

  // Set cards
  const CARD_H = 110;
  const CARD_PAD = 22;
  const CARD_X = 48;
  const CARD_W = CANVAS_W - 96;
  let y = 272;

  // Group by day
  const dayGroups = new Map();
  myPickSets.forEach(set => {
    const dayIdx = (festival.days || []).findIndex(d => (d.sets || []).some(s => s.id === set.id));
    const dayLabel = festival.days?.[dayIdx]?.label || `Day ${dayIdx + 1}`;
    if (!dayGroups.has(dayLabel)) dayGroups.set(dayLabel, []);
    dayGroups.get(dayLabel).push(set);
  });

  for (const [dayLabel, sets] of dayGroups) {
    // Day header
    ctx.fillStyle = TEXT_SEC;
    ctx.font = 'bold 28px "Space Grotesk", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(dayLabel.toUpperCase(), CARD_X, y + 24);
    y += 42;

    for (const set of sets) {
      const priority = picks[set.id];
      const priColor = PRIORITY_COLORS[priority] || TEXT_SEC;

      // Card bg
      ctx.fillStyle = GLASS;
      roundRect(ctx, CARD_X, y, CARD_W, CARD_H, CARD_RADIUS);
      ctx.fill();

      // Priority left bar
      ctx.fillStyle = priColor;
      roundRect(ctx, CARD_X, y, 6, CARD_H, 3);
      ctx.fill();

      // Artist name
      ctx.fillStyle = TEXT_PRI;
      ctx.font = 'bold 36px "Space Grotesk", system-ui, sans-serif';
      ctx.textAlign = 'left';
      const artistText = artistDisplayName(set, festival.b2bSeparator);
      const maxW = CARD_W - 80;
      let displayText = artistText;
      while (ctx.measureText(displayText).width > maxW && displayText.length > 0) {
        displayText = displayText.slice(0, -1);
      }
      if (displayText.length < artistText.length) displayText += '\u2026';
      ctx.fillText(displayText, CARD_X + 24, y + 46);

      // Time + stage
      ctx.fillStyle = TEXT_SEC;
      ctx.font = '26px "Space Grotesk", system-ui, sans-serif';
      const stageName = (festival.stages || []).find(s => s.id === set.stageId)?.name || '';
      const timeStr = set.startTime ? formatTime(set.startTime) : 'TBA';
      ctx.fillText(timeStr + (stageName ? '  \u00B7  ' + stageName : ''), CARD_X + 24, y + 84);

      // Priority chip
      ctx.fillStyle = priColor + '30';
      roundRect(ctx, CARD_X + CARD_W - 180, y + 20, 160, 36, 8);
      ctx.fill();
      ctx.fillStyle = priColor;
      ctx.font = 'bold 20px "Space Grotesk", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(PRIORITY_LABELS[priority] || '', CARD_X + CARD_W - 100, y + 44);

      y += CARD_H + CARD_PAD;

      if (y > CANVAS_H - 160) break; // overflow guard
    }
    if (y > CANVAS_H - 160) break;
    y += 12;
  }

  // Footer watermark
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.font = '26px "Space Grotesk", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('festie.us', CANVAS_W / 2, CANVAS_H - 48);

  return canvas;
}

export async function shareSchedule() {
  const canvas = await generateScheduleImage();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

  if (navigator.share && navigator.canShare?.({ files: [new File([blob], 'my-lineup.png', { type: 'image/png' })] })) {
    await navigator.share({
      files: [new File([blob], 'my-lineup.png', { type: 'image/png' })],
      title: 'My Festival Lineup',
    });
    return { method: 'share' };
  }

  // Fallback: download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'my-lineup.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { method: 'download' };
}
