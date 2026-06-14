import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@festie/shared/services';
import { makeStyles, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import PressableScale from './PressableScale';

/**
 * Rating scale mirrors the web RatingButtons (shared lib/ratingIcon): vector
 * icons instead of OS-font emoji, so it renders consistently and stays tintable.
 *   5 Fire · 4 Good · 3 Okay · 2 Meh · 1 Skip
 */
const RATINGS: readonly { n: number; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { n: 5, icon: 'flame', label: 'Fire' },
  { n: 4, icon: 'happy', label: 'Good' },
  { n: 3, icon: 'thumbs-up', label: 'Okay' },
  { n: 2, icon: 'remove', label: 'Meh' },
  { n: 1, icon: 'thumbs-down', label: 'Skip' },
];

interface Rating {
  setId: string;
  rating: number;
  note?: string | null;
}

interface RatingButtonsProps {
  /** The set being rated. */
  setId: string;
  /** Festival id — used to fetch existing ratings on mount. */
  festivalId: string;
}

/**
 * Mobile rating primitive — 5 emoji buttons in a row. Mirrors the web
 * RatingButtons behavior: tapping a rating upserts it (POST /ratings/:setId),
 * re-tapping the active rating removes it (DELETE /ratings/:setId). Mobile has
 * no react-query/offline-queue bridge, so this uses plain api calls with an
 * optimistic local useState that rolls back on error. CONFIRMED endpoints:
 * GET /ratings/festival/:festivalId (api.get unwraps the success envelope to
 * the { ratings } object), POST /ratings/:setId { rating }, DELETE
 * /ratings/:setId.
 */
export default function RatingButtons({ setId, festivalId }: RatingButtonsProps) {
  const styles = useStyles();
  const t = useTokens();
  const haptics = useHaptics();
  const [current, setCurrent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Fetch the current rating for this set on mount.
  useEffect(() => {
    if (!festivalId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ ratings: Rating[] } | Rating[]>(`/ratings/festival/${festivalId}`);
        const ratings = Array.isArray(res) ? res : res?.ratings || [];
        const found = ratings.find((r) => r.setId === setId);
        if (!cancelled) setCurrent(found?.rating ?? null);
      } catch {
        /* No ratings available */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [festivalId, setId]);

  const handlePress = useCallback(
    async (n: number) => {
      if (busy) return;
      // Selection haptic on tap — parity with the priority picker and the
      // segmented control so equivalent "I chose this" controls all confirm (F18).
      haptics.select();
      setBusy(true);
      const prev = current;
      const removing = current === n;
      // Optimistic local update.
      setCurrent(removing ? null : n);
      try {
        if (removing) {
          await api.delete(`/ratings/${setId}`);
        } else {
          await api.post(`/ratings/${setId}`, { rating: n });
        }
      } catch {
        // Roll back on failure.
        setCurrent(prev);
      } finally {
        setBusy(false);
      }
    },
    [busy, current, setId, haptics],
  );

  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Rate this set">
      {RATINGS.map((r) => {
        const active = current === r.n;
        return (
          <PressableScale
            key={r.n}
            style={[styles.button, active && styles.buttonActive]}
            onPress={() => handlePress(r.n)}
            disabled={busy}
            accessibilityRole="radio"
            // radio/checkbox roles announce on/off via `checked` (TalkBack
            // ignores `selected` for radios); keep `selected` for iOS parity (F44).
            accessibilityState={{ checked: active, selected: active, disabled: busy }}
            accessibilityLabel={`${r.label} (${r.n} of 5)`}
          >
            <Ionicons name={r.icon} size={22} color={active ? t.colors.accent.amber : t.colors.text.secondary} />
          </PressableScale>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  button: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.card,
  },
  buttonActive: {
    borderColor: t.colors.accent.amber,
    backgroundColor: t.colors.accent.amber + '40',
  },
}));
