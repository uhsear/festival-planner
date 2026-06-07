import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

/**
 * One-time first-run intro. A 3-slide explainer shown over the app on first
 * launch (gated by an AsyncStorage flag owned by the caller). Gives a cold
 * install context — what Festie does — instead of dropping users on a bare
 * festival picker. `onDone` fires for both Skip and Get started.
 */
const SLIDES: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  {
    icon: 'calendar-outline',
    title: 'Build your festival schedule',
    body: 'Pick the sets you can’t miss across every stage and see your day at a glance.',
  },
  {
    icon: 'people-outline',
    title: 'Coordinate with your crew',
    body: 'Join a crew, compare schedules, and drop meeting points so nobody gets lost.',
  },
  {
    icon: 'notifications-outline',
    title: 'Never miss a set',
    body: 'Get a reminder before each of your picks starts — even when the signal drops.',
  },
];

export default function FirstRunIntro({ onDone }: { onDone: () => void }) {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);

  const isLast = index === SLIDES.length - 1;
  const slide = SLIDES[index]!;

  return (
    <View style={[styles.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.skipRow}>
        <TouchableOpacity onPress={onDone} accessibilityRole="button" accessibilityLabel="Skip intro">
          <Text style={styles.skip}>Skip</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        <View style={styles.iconCircle}>
          <Ionicons name={slide.icon} size={48} color={t.colors.accent.aqua} />
        </View>
        <Text style={styles.title}>{slide.title}</Text>
        <Text style={styles.text}>{slide.body}</Text>
      </View>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
        <TouchableOpacity
          style={styles.button}
          onPress={() => (isLast ? onDone() : setIndex((i) => i + 1))}
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
    paddingHorizontal: t.spacing[6],
    zIndex: 100,
  },
  skipRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: t.spacing[3],
  },
  skip: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[4],
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.bg.secondary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    marginBottom: t.spacing[2],
  },
  title: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  text: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  footer: {
    gap: t.spacing[4],
    paddingBottom: t.spacing[6],
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
    backgroundColor: t.colors.border.default,
  },
  dotActive: {
    backgroundColor: t.colors.accent.aqua,
    width: 20,
  },
  button: {
    // PRIMARY action = aqua fill + dark ink (text.onLightAccent), per the
    // accent rule. Coral is reserved for danger/SOS only.
    backgroundColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[4],
    alignItems: 'center',
  },
  buttonText: {
    ...typeStyle('label'),
    color: t.colors.text.onLightAccent,
  },
}));
