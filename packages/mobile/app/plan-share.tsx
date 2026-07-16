// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import PlanQRShare from '../components/PlanQRShare';
import PlanQRScan from '../components/PlanQRScan';
import SmsHandoff from '../components/SmsHandoff';

// ── Plan share (M5 P2P) ────────────────────────────────────────────────────
// One screen, three offline-honest ways to get a friend onto the same plan when
// signal is dead:
//   • Show QR  — render your plan as a QR for a friend to scan (PlanQRShare)
//   • Scan QR  — scan a friend's plan into your local cache (PlanQRScan)
//   • Text     — last-resort SMS handoff of the meeting point (SmsHandoff)
// All three consume the shared, versioned planSnapshot codec / meeting-point
// data; none of them require the internet.

type Tab = 'show' | 'scan' | 'text';

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'show', label: 'Show QR', icon: 'qr-code' },
  { key: 'scan', label: 'Scan QR', icon: 'scan' },
  { key: 'text', label: 'Text crew', icon: 'chatbubble-ellipses' },
];

export default function PlanShareScreen() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const [tab, setTab] = useState<Tab>('show');

  const selectTab = (key: Tab) => {
    if (key !== tab) {
      haptics.select();
    }
    setTab(key);
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Share plan', headerShown: true }} />

      <View style={styles.tabBar}>
        {TABS.map((item) => {
          const active = tab === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              testID={`plan-share-tab-${item.key}`}
              style={[styles.tab, active && styles.tabActive]}
              activeOpacity={0.7}
              onPress={() => selectTab(item.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
            >
              <Ionicons
                name={item.icon}
                size={16}
                color={active ? t.colors.text.onLightAccent : t.colors.text.secondary}
              />
              <Text
                style={[styles.tabText, active && styles.tabTextActive]}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.body}>
        {tab === 'show' ? <PlanQRShare /> : null}
        {tab === 'scan' ? <PlanQRScan /> : null}
        {tab === 'text' ? <SmsHandoff /> : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  tabBar: {
    flexDirection: 'row',
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    minHeight: 44,
  },
  tabActive: {
    backgroundColor: t.colors.accent.aqua,
    borderColor: t.colors.accent.aqua,
  },
  tabText: {
    ...typeStyle('caption', 600),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  tabTextActive: {
    color: t.colors.text.onLightAccent,
  },
  body: {
    flex: 1,
  },
}));
