import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { FestivalPhase } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

type ActionKey = 'picks' | 'crew' | 'find' | 'nownext' | 'wrap';

interface ActionDef {
  key: ActionKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: string;
  a11y: string;
  /** Safety-adjacent destination (live map / SOS) → coral icon per the accent rule. */
  danger?: boolean;
}

// Fixed destination set. Phase never adds or removes a destination — it only
// reorders and re-emphasizes — so everything stays reachable in every phase.
const ACTIONS: Record<ActionKey, ActionDef> = {
  picks: { key: 'picks', label: 'My picks', icon: 'star', href: '/(tabs)/picks', a11y: 'Open my picks' },
  crew: { key: 'crew', label: 'Crew', icon: 'people', href: '/(tabs)/crew', a11y: 'Open crew' },
  find: {
    key: 'find',
    label: 'Find each other',
    icon: 'location',
    href: '/find',
    a11y: 'Find each other — crew map, compass and meeting points',
    danger: true,
  },
  nownext: { key: 'nownext', label: 'Now & Next', icon: 'flash', href: '/festival-mode', a11y: 'Open Now and Next' },
  wrap: { key: 'wrap', label: 'Festival wrap', icon: 'sparkles', href: '/wrap', a11y: 'Open festival wrap-up' },
};

// Per-phase ordering — the first entry is the emphasized (primary) action.
// 'live' deliberately leads with Find + Crew so the live map / SOS / meeting
// points are never buried behind planning content (Coachella phased-content
// model: re-prioritize per phase, never hide).
const PHASE_ORDER: Record<FestivalPhase, ActionKey[]> = {
  pre: ['picks', 'crew', 'nownext', 'find', 'wrap'],
  live: ['find', 'crew', 'nownext', 'picks', 'wrap'],
  post: ['wrap', 'crew', 'picks', 'nownext', 'find'],
};

const PHASE_HEADING: Record<FestivalPhase, { label: string; hint: string }> = {
  pre: { label: 'Before the festival', hint: 'Lock in your picks and rally your crew.' },
  live: { label: 'Happening now', hint: 'Find your crew, check Now & Next, stay safe.' },
  post: { label: 'Festival wrap', hint: 'Relive it and settle up with your crew.' },
};

interface PhaseHomeActionsProps {
  phase: FestivalPhase;
}

/**
 * P1-5 — phase-aware home actions. A compact, horizontally-scrolling shortcut
 * band on the Schedule landing that re-prioritizes the crew's destinations by
 * festival PHASE (derived from the date range vs now via shared `festivalPhase`):
 *  - pre  → picks / crew invites lead
 *  - live → Find each other (map/SOS/meeting) + crew lead; Now & Next stays one tap away
 *  - post → festival wrap + settle-up lead
 *
 * The destination set is fixed — phase only reorders and emphasizes the lead —
 * so nothing is ever hidden, only re-prioritized.
 */
export default function PhaseHomeActions({ phase }: PhaseHomeActionsProps) {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();

  const order = PHASE_ORDER[phase];
  const heading = PHASE_HEADING[phase];

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>{heading.label}</Text>
      <Text style={styles.hint}>{heading.hint}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {order.map((key, i) => {
          const a = ACTIONS[key];
          const primary = i === 0;
          const iconColor = a.danger ? t.colors.accent.coral : primary ? t.colors.accent.aqua : t.colors.text.secondary;
          return (
            <TouchableOpacity
              key={key}
              testID={`phase-action-${key}`}
              style={[styles.chip, primary && styles.chipPrimary]}
              onPress={() => router.navigate(a.href)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={a.a11y}
            >
              <Ionicons name={a.icon} size={16} color={iconColor} />
              <Text style={[styles.chipText, primary && styles.chipTextPrimary]} numberOfLines={1}>
                {a.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    gap: t.spacing[1],
    // Separate the phase block from the filter controls above it.
    marginTop: t.spacing[3],
    paddingBottom: t.spacing[2],
  },
  heading: {
    // typeStyle('caption', 700) selects SpaceGrotesk_700Bold — correct cut.
    // Spreading typeStyle() then overriding fontWeight is inert on native
    // because the weighted fontFamily wins (F4 faux-bold fix).
    ...typeStyle('caption', 700),
    color: t.colors.text.muted,
    textTransform: 'uppercase',
  },
  hint: {
    // Downsize to micro so the hint reads as contextual annotation rather than
    // competing with the filter controls in the same visual register.
    ...typeStyle('micro'),
    color: t.colors.text.secondary,
    marginBottom: t.spacing[1],
  },
  row: {
    gap: t.spacing[2],
    paddingVertical: t.spacing[1],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    // WCAG 2.5.5 / 2.5.8 minimum 44px touch target — matches the day/filter chips.
    minHeight: 44,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  // Emphasized lead action for the current phase — aqua-tinted fill + border so
  // it carries more weight than the rest without becoming a loud solid CTA
  // (coral is reserved for danger/SOS). Mirrors crew.tsx's overlapTogglePrimary.
  chipPrimary: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  chipText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  chipTextPrimary: {
    color: t.colors.accent.aqua,
    fontWeight: '700',
  },
}));
