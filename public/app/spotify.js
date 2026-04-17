/**
 * Spotify embed player — floating iframe bar
 * Uses standard Spotify embed iframes (not the IFrame API, which requires unsafe-eval).
 * Autoplay: best-effort via ?autoplay=1 URL param. Chrome may or may not honor it
 * depending on user engagement score with the site. The embed always loads and the
 * user can tap play within the Spotify player if autoplay doesn't fire.
 */
export function initSpotify() {
  let currentSetId = null;
  let listeners = [];
  const cache = new Map();
  let playerBar = null;
  let playerIframe = null;
  let playerTitle = null;
  let playerCloseBtn = null;

  function notify() { listeners.forEach(fn => fn(currentSetId, currentSetId !== null)); }

  function createPlayerBar() {
    if (playerBar) return;
    playerBar = document.createElement('div');
    playerBar.className = 'spotify-player-bar';

    const header = document.createElement('div');
    header.className = 'spotify-player-header';

    const titleEl = document.createElement('span');
    titleEl.className = 'spotify-player-title';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'spotify-player-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close player');
    closeBtn.textContent = '\u00D7'; // ×

    header.append(titleEl, closeBtn);

    const embed = document.createElement('div');
    embed.className = 'spotify-player-embed';

    playerBar.replaceChildren(header, embed);
    document.body.appendChild(playerBar);

    playerTitle = titleEl;
    playerCloseBtn = closeBtn;
    playerCloseBtn.addEventListener('click', () => close());
  }

  function close() {
    if (playerBar) {
      playerBar.classList.remove('spotify-player-visible');
      const embedContainer = playerBar.querySelector('.spotify-player-embed');
      if (embedContainer) embedContainer.replaceChildren();
      playerIframe = null;
    }
    const prev = currentSetId;
    currentSetId = null;
    if (prev) notify();
  }

  async function fetchPreview(setId) {
    if (cache.has(setId)) return cache.get(setId);
    try {
      const resp = await fetch(`/api/v1/spotify/preview/${setId}`, { credentials: 'same-origin' });
      if (!resp.ok) return null;
      const data = await resp.json();
      const result = data.data || data;
      cache.set(setId, result);
      return result;
    } catch { return null; }
  }

  function buildEmbedUrl(preview) {
    if (preview.embedType === 'track' && preview.trackId) {
      return `https://open.spotify.com/embed/track/${preview.trackId}?theme=0&utm_source=generator`;
    }
    if (preview.embedType === 'artist' && preview.artistId) {
      return `https://open.spotify.com/embed/artist/${preview.artistId}?theme=0&utm_source=generator`;
    }
    return null;
  }

  function buildLabel(preview) {
    return preview.trackName ? `${preview.trackName} — ${preview.artistName}` : preview.artistName;
  }

  async function play(setId) {
    const preview = await fetchPreview(setId);
    if (!preview?.embedType) return false;

    // Toggle off if same set
    if (currentSetId === setId) {
      close();
      return false;
    }

    createPlayerBar();

    const embedUrl = buildEmbedUrl(preview);
    if (!embedUrl) return false;

    const label = buildLabel(preview);
    playerTitle.textContent = label;

    // Create iframe
    const embedContainer = playerBar.querySelector('.spotify-player-embed');
    embedContainer.replaceChildren();
    playerIframe = document.createElement('iframe');
    playerIframe.src = embedUrl;
    playerIframe.width = '100%';
    playerIframe.height = '80';
    playerIframe.frameBorder = '0';
    playerIframe.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    playerIframe.loading = 'lazy';
    playerIframe.title = 'Spotify player: ' + label;
    embedContainer.appendChild(playerIframe);

    playerBar.classList.add('spotify-player-visible');
    currentSetId = setId;
    notify();
    return true;
  }

  function pause() { close(); }
  function isPlaying(setId) { return currentSetId === setId; }
  function onStateChange(fn) { listeners.push(fn); return () => { listeners = listeners.filter(l => l !== fn); }; }
  function getCurrentSetId() { return currentSetId; }

  /**
   * Get embed data for inline use (detail panel)
   */
  async function getEmbedHtml(setId) {
    const preview = await fetchPreview(setId);
    if (!preview?.embedType) return null;
    const embedUrl = buildEmbedUrl(preview);
    if (!embedUrl) return null;
    return { embedUrl, label: buildLabel(preview) };
  }

  return { fetchPreview, play, pause, isPlaying, onStateChange, getCurrentSetId, getEmbedHtml, close };
}
