import Button from '../ui/Button';

interface Props {
  preview: { embedUrl: string; label: string; embedType: string };
  visible: boolean;
  onToggle: () => void;
}

export default function DetailSpotifySection({ preview, visible, onToggle }: Props) {
  return (
    <div className="my-2.5">
      <Button variant="outline" size="sm" type="button" onClick={onToggle} aria-expanded={visible}>
        {visible ? '\u25B2 Hide Player' : '\u25B6 Listen on Spotify'}
      </Button>
      {visible && (
        <div className="my-2.5 rounded-xl overflow-hidden">
          <iframe
            src={preview.embedUrl}
            width="100%"
            height="152"
            frameBorder="0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            title={'Spotify: ' + preview.label}
            className="block w-full rounded-xl"
          />
        </div>
      )}
    </div>
  );
}
