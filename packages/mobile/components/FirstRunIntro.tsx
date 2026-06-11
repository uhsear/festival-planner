import { useCallback, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

/**
 * One-time first-run intro. A 3-slide explainer shown over the app on first
 * launch (gated by an AsyncStorage flag owned by the caller). Gives a cold
 * install context — what Festie does — instead of dropping users on a bare
 * festival picker. `onDone` fires for both Skip and Get started.
 *
 * Layout intent (design roadmap P2-1): the slide visual sits in the upper half
 * and the value-first copy is anchored low (just above the controls) rather than
 * dead-centered, so the screen doesn't read as a generic empty template. Slide 1
 * leads with a product visual (a miniature of the picks/schedule surface); the
 * remaining slides use a single accent glyph. Copy is single-sourced in `SLIDES`.
 */
interface Slide {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  /** Slide 1 renders the product visual instead of the icon glyph. */
  showProductVisual?: boolean;
}

const SLIDES: Slide[] = [
  {
    icon: 'calendar-outline',
    title: 'Your festival, planned',
    body: 'Pick the sets you can’t miss across every stage and see your whole weekend at a glance.',
    showProductVisual: true,
  },
  {
    icon: 'people-outline',
    title: 'Keep your crew together',
    body: 'Compare schedules, drop meeting points, and find each other when the signal drops.',
  },
  {
    icon: 'notifications-outline',
    title: 'Never miss a set',
    body: 'Get a reminder before every pick starts — even when you’re offline.',
  },
];

/** A miniature of the picks surface — a "Friday" day card with priority-tiered
 *  set rows. Pure decoration (hidden from the a11y tree) that signals the
 *  product instead of a generic centered icon. */
function ProductVisual() {
  const t = useTokens();
  const styles = useStyles();
  const rows: { color: string; w: number; time: string }[] = [
    { color: t.colors.priority.must, w: 0.78, time: '8:30' },
    { color: t.colors.priority.want, w: 0.62, time: '9:45' },
    { color: t.colors.priority.maybe, w: 0.7, time: '11:00' },
  ];
  return (
    <View style={styles.visualCard} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.visualHeader}>
        <Text style={styles.visualDay}>Friday</Text>
        <View style={styles.visualPill}>
          <Text style={styles.visualPillText}>3 picks</Text>
        </View>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={styles.visualRow}>
          <View style={[styles.visualDot, { backgroundColor: r.color }]} />
          <View style={styles.visualBars}>
            <View style={[styles.visualBar, { width: `${r.w * 100}%` }]} />
            <View style={[styles.visualBarSub, { width: `${r.w * 64}%` }]} />
          </View>
          <Text style={styles.visualTime}>{r.time}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * DC16: Real horizontal paging pager. Slides are laid out in a horizontal
 * ScrollView with pagingEnabled; `index` is driven by onMomentumScrollEnd so
 * the dots always reflect where the user actually landed. The Next button
 * remains as a secondary/keyboard path — it programmatically scrolls to the
 * next page instead of toggling state directly, keeping both paths in sync.
 */
export default function FirstRunIntro({ onDone }: { onDone: () => void }) {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const screenWidth = Dimensions.get('window').width;
  const isLast = index === SLIDES.length - 1;

  // Scroll to the target page programmatically (used by the Next button).
  const scrollToPage = useCallback(
    (page: number) => {
      scrollRef.current?.scrollTo({ x: page * screenWidth, animated: true });
    },
    [screenWidth],
  );

  // Update the dot indicator when a swipe lands on a page boundary.
  const handleMomentumScrollEnd = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      const page = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
      setIndex(page);
    },
    [screenWidth],
  );

  const handleNext = useCallback(() => {
    if (isLast) {
      onDone();
    } else {
      const nextPage = index + 1;
      setIndex(nextPage);
      scrollToPage(nextPage);
    }
  }, [isLast, index, onDone, scrollToPage]);

  return (
    <View style={[styles.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.skipRow}>
        <TouchableOpacity
          onPress={onDone}
          accessibilityRole="button"
          accessibilityLabel="Skip intro"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.skip}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* Paging ScrollView — each slide gets exactly one screen-width slot. */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        style={styles.pager}
        contentContainerStyle={styles.pagerContent}
        accessibilityRole="adjustable"
        accessibilityLabel="Intro slides"
      >
        {SLIDES.map((slide, i) => (
          <View key={i} style={[styles.slide, { width: screenWidth }]}>
            {/* Upper region: the slide visual, centered in the top half. */}
            <View style={styles.hero}>
              {slide.showProductVisual ? (
                <ProductVisual />
              ) : (
                <View
                  style={styles.iconCircle}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  <Ionicons name={slide.icon} size={56} color={t.colors.accent.aqua} />
                </View>
              )}
            </View>

            {/* Value-first copy, anchored low (just above the controls). */}
            <View style={styles.copy}>
              <Text style={styles.title} accessibilityRole="header">
                {slide.title}
              </Text>
              <Text style={styles.text}>{slide.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
        <TouchableOpacity
          style={styles.button}
          onPress={handleNext}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={isLast ? 'Get started' : 'Next'}
        >
          <Text style={styles.buttonText}>{isLast ? 'Get started' : 'Next'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  overlay: {
    ...({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const),
    backgroundColor: t.colors.bg.primary,
    zIndex: 100,
  },
  skipRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: t.spacing[3],
    paddingHorizontal: t.spacing[6],
  },
  skip: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  // DC16: pager container takes all remaining vertical space above the footer.
  pager: {
    flex: 1,
  },
  pagerContent: {
    // alignItems stretch so each slide fills the pager's cross-axis (height).
    // The pager itself gets height via flex:1, so this makes each slide fill
    // that measured height without needing an explicit pixel value.
    alignItems: 'stretch' as const,
  },
  // Each slide is exactly one screen-width wide (set inline from Dimensions).
  // Height is inherited from the content container's alignItems: 'stretch'.
  slide: {
    paddingHorizontal: t.spacing[6],
  },
  // Upper region: visual sits in the top third, not dead-centered. flex:1
  // fills remaining height so the copy block stays anchored at the bottom.
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: t.spacing[10],
  },
  copy: {
    gap: t.spacing[3],
    paddingBottom: t.spacing[8],
  },
  iconCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    // aquaAlpha[12] (was [6]) gives enough fill to distinguish the circle
    // shape from a pure-black (#0a0a0a) background. Border bumped to [20]
    // so the container boundary reads clearly.
    backgroundColor: t.colors.aquaAlpha[12],
    borderWidth: 1,
    borderColor: t.colors.aquaAlpha[20],
  },
  // ── Product visual (slide 1) ───────────────────────────────────────────────
  visualCard: {
    width: '100%',
    maxWidth: 320,
    padding: t.spacing[4],
    gap: t.spacing[3],
    borderRadius: t.radii.lg,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  visualHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  visualDay: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  visualPill: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[20],
    borderWidth: 1,
    borderColor: t.colors.aquaAlpha[30],
  },
  visualPillText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  visualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingVertical: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.card,
  },
  visualDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  visualBars: {
    flex: 1,
    gap: t.spacing[2],
  },
  visualBar: {
    height: 8,
    borderRadius: t.radii.xs,
    backgroundColor: t.colors.overlay[5],
  },
  visualBarSub: {
    height: 6,
    borderRadius: t.radii.xs,
    backgroundColor: t.colors.overlay[3],
  },
  visualTime: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  // ───────────────────────────────────────────────────────────────────────────
  title: {
    ...typeStyle('heading'),
    color: t.colors.text.primary,
  },
  text: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  footer: {
    gap: t.spacing[4],
    paddingBottom: t.spacing[6],
    paddingHorizontal: t.spacing[6],
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: t.spacing[2],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    // border.light is only rgba(255,255,255,0.1) — near-invisible on #0a0a0a.
    // Use 25% white so inactive dots read as a clear progress indicator.
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  dotActive: {
    backgroundColor: t.colors.accent.aqua,
    width: 20,
    borderRadius: 9999,
  },
  button: {
    // PRIMARY action = aqua fill + dark ink (text.onLightAccent), per the
    // accent rule. Coral is reserved for danger/SOS only.
    backgroundColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[4],
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    // weight 600 → SpaceGrotesk_600SemiBold so the label reads at adequate
    // weight on the bright aqua fill (500Medium was too light).
    ...typeStyle('label', 600),
    color: t.colors.text.onLightAccent,
  },
}));
