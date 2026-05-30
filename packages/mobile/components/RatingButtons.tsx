import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { api } from '@festie/shared/services';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

/**
 * Emoji scale mirrors the web RatingButtons + legacy ratings.js:
 *   5 🔥 Fire · 4 😊 Good · 3 👍 Okay · 2 🤔 Meh · 1 👎 Skip
 */
const RATINGS: readonly { n: number; emoji: string; label: string }[] = [
  { n: 5, emoji: '🔥', label: 'Fire' },
  { n: 4, emoji: '😊', label: 'Good' },
  { n: 3, emoji: '👍', label: 'Okay' },
  { n: 2, emoji: '🤔', label: 'Meh' },
  { n: 1, emoji: '👎', label: 'Skip' },
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
  const t = useTokens();
  const styles = useStyles();
  const [current, setCurrent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Fetch the current rating for this set on mount.
  useEffect(() => {
    if (!festivalId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ ratings: Rating[] } | Rating[]>(
          `/ratings/festival/${festivalId}`,
        );
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
    [busy, current, setId],
  );

  return (
    <View
      style={styles.row}
      accessibilityRole="radiogroup"
      accessibilityLabel="Rate this set"
    >
      {RATINGS.map((r) => {
        const active = current === r.n;
        return (
          <TouchableOpacity
            key={r.n}
            style={[styles.button, active && styles.buttonActive]}
            onPress={() => handlePress(r.n)}
            disabled={busy}
            activeOpacity={0.7}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled: busy }}
            accessibilityLabel={`${r.label} (${r.n} of 5)`}
          >
            <Text style={[styles.emoji, active && styles.emojiActive]}>
              {r.emoji}
            </Text>
          </TouchableOpacity>
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
  emoji: {
    ...typeStyle('title'),
  },
  emojiActive: {
    ...typeStyle('heading'),
  },
}));
