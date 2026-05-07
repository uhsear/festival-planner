interface Props {
  preview: { embedUrl: string; label: string; embedType: string };
  visible: boolean;
  onToggle: () => void;
}

export default function DetailSpotifySection({ preview, visible, onToggle }: Props) {
  return (
    <div className="detail-spotify-section" style={{ margin: '10px 0' }}>
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        onClick={onToggle}
      >
        {visible ? '\u25B2 Hide Player' : '\u25B6 Listen on Spotify'}
      </button>
      {visible && (
        <div
          className="detail-spotify-embed"
          style={{ marginTop: 8, borderRadius: 12, overflow: 'hidden' }}
        >
          <iframe
            src={preview.embedUrl}
            width="100%"
            height="152"
            frameBorder="0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            title={'Spotify: ' + preview.label}
            style={{ display: 'block', borderRadius: 12 }}
          />
        </div>
      )}
    </div>
  );
}
