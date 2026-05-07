interface Props {
  preview: { embedUrl: string; label: string; embedType: string };
  visible: boolean;
  onToggle: () => void;
}

export default function DetailSpotifySection({ preview, visible, onToggle }: Props) {
  return (
    <div className="detail-spotify-section my-2.5">
      <button
        className="btn btn-ghost btn-sm flex items-center gap-1.5"
        type="button"
        onClick={onToggle}
      >
        {visible ? '\u25B2 Hide Player' : '\u25B6 Listen on Spotify'}
      </button>
      {visible && (
        <div className="detail-spotify-embed mt-2 overflow-hidden rounded-xl">
          <iframe
            src={preview.embedUrl}
            width="100%"
            height="152"
            frameBorder="0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            title={'Spotify: ' + preview.label}
            className="block rounded-xl"
          />
        </div>
      )}
    </div>
  );
}
