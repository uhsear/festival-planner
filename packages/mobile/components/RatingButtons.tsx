import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, mapErrorToUserMessage } from '@festie/shared/services';
import { RATING_SCALE_DATA } from '@festie/shared/constants';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import PressableScale from './PressableScale';

/**
 * Mobile-specific icon map paired with the shared rating scale data. The pure
 * data (value, label, order) comes from RATING_SCALE_DATA; this adds Ionicons
 * names which are mobile-only. Web uses Lucide icons (see lib/ratingIcon.tsx).
 */
const ICON_FOR_RATING: Record<number, keyof typeof Ionicons.glyphMap> = {
  5: 'flame',
  4: 'happy',
  3: 'thumbs-up',
  2: 'remove',
  1: 'thumbs-down',
};

/** Merged RATING_SCALE_DATA + platform icon — rendered high→low (order ascending). */
const RATINGS = RATING_SCALE_DATA.map((r) => ({
  n: r.value,
  icon: ICON_FOR_RATING[r.value]!,
  label: r.label,
}));

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
  // Set when an optimistic write rolls back, so the failure is VISIBLE (not just
  // a haptic, which is silent for users with haptics disabled). Mobile ratings
  // don't go through the offline queue, so a tap while offline would otherwise
  // fill-then-quietly-vanish with no explanation.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Until the initial GET resolves we don't know if there's an existing rating,
  // so we hold the controls at a slightly reduced opacity and show "Loading…"
  // rather than flashing the "Tap to rate" hint and then a filled state.
  const [loaded, setLoaded] = useState(false);

  // Fetch the current rating for this set on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // No festival id → nothing to fetch; just release the loading affordance
      // (kept inside the async callback so we never setState synchronously in
      // the effect body, which would trigger a cascading render).
      if (!festivalId) {
        if (!cancelled) setLoaded(true);
        return;
      }
      try {
        const res = await api.get<{ ratings: Rating[] } | Rating[]>(`/ratings/festival/${festivalId}`);
        const ratings = Array.isArray(res) ? res : res?.ratings || [];
        const found = ratings.find((r) => r.setId === setId);
        if (!cancelled) setCurrent(found?.rating ?? null);
      } catch {
        /* No ratings available */
      } finally {
        if (!cancelled) setLoaded(true);
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
      setSaveError(null);
      const prev = current;
      const removing = current === n;
      // Optimistic local update.
      setCurrent(removing ? null : n);
      try {
        if (removing) {
          await api.delete(`/ratings/${setId}`);
        } else {
          await api.post(`/ratings/${setId}`, { rating: n });
          // Success notification only when COMMITTING a rating (not clearing) —
          // a small "logged it" confirmation, distinct from the per-tap select.
          haptics.success();
        }
      } catch (e) {
        // Roll back on failure + a warning buzz AND an explicit message — offline
        // is the common cause (no offline queue here), and mapErrorToUserMessage
        // distinguishes "you appear to be offline" from server/other failures.
        haptics.warning();
        setCurrent(prev);
        setSaveError(mapErrorToUserMessage(e, "Couldn't save — try again."));
      } finally {
        setBusy(false);
      }
    },
    [busy, current, setId, haptics],
  );

  // The human-readable label for the current rating, used in the caption + the
  // group accessibility value so the chosen rating is spoken on focus.
  const currentLabel = useMemo(() => RATINGS.find((r) => r.n === current)?.label ?? null, [current]);

  return (
    <View>
      <View
        style={[styles.row, !loaded && styles.rowLoading]}
        accessibilityRole="radiogroup"
        accessibilityLabel="Rate this set"
        accessibilityHint="Choose 1 to 5; tap the active rating again to remove it"
        // Speak the chosen rating (or "Not rated") when the group gains focus, so
        // the current value is announced without tabbing through every button.
        accessibilityValue={{ text: currentLabel ?? 'Not rated' }}
      >
        {RATINGS.map((r) => {
          const active = current === r.n;
          return (
            <PressableScale
              key={r.n}
              style={[styles.button, active && styles.buttonActive]}
              onPress={() => handlePress(r.n)}
              disabled={busy || !loaded}
              hitSlop={6}
              accessibilityRole="radio"
              // radio/checkbox roles announce on/off via `checked` (TalkBack
              // ignores `selected` for radios); keep `selected` for iOS parity (F44).
              accessibilityState={{ checked: active, selected: active, disabled: busy || !loaded }}
              accessibilityLabel={`${r.label} (${r.n} of 5)`}
            >
              <Ionicons name={r.icon} size={22} color={active ? t.colors.accent.amber : t.colors.text.secondary} />
            </PressableScale>
          );
        })}
      </View>
      <Text
        style={[
          styles.caption,
          saveError ? styles.captionError : currentLabel ? styles.captionActive : null,
        ]}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        numberOfLines={2}
        // The rollback message is the one caption state worth announcing — keep
        // the routine "Tap to rate" / "You rated this" hints hidden from a11y
        // (the radiogroup's accessibilityValue already conveys the rating).
        accessibilityElementsHidden={!saveError}
        importantForAccessibility={saveError ? 'yes' : 'no'}
        accessibilityLiveRegion={saveError ? 'polite' : 'none'}
      >
        {!loaded
          ? 'Loading…'
          : saveError
            ? saveError
            : currentLabel
              ? `You rated this: ${currentLabel}`
              : 'Tap to rate this set'}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  rowLoading: {
    opacity: 0.55,
  },
  caption: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    marginTop: t.spacing[2],
    textAlign: 'center',
  },
  captionActive: {
    color: t.colors.accent.amber,
  },
  captionError: {
    color: t.colors.accent.coral,
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
