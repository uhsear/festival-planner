import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, createWidget, type LiveActivityEnvironment, type WidgetEnvironment } from 'expo-widgets';

/**
 * Festie "Now & Next" iOS Live Activity + Home-Screen Widget (SDK 56 expo-widgets).
 *
 * Both surfaces present the same on-device model that powers the Android ongoing
 * notification (`buildOngoingNotificationModel` → { title, body }).
 *
 * Live Activity: Lock Screen banner + Dynamic Island, driven from JS via
 * lib/liveActivity.ts (start/update/end).
 *
 * Home-screen widget: systemSmall (2×2) and systemMedium (4×2) layouts compiled
 * to SwiftUI by expo-widgets at build time. Timeline is kept current by
 * hooks/useOngoingNotification.ts calling NowNextWidget.updateSnapshot() whenever
 * the model changes — same rhythm as the Live Activity update.
 *
 * Brand: aqua accent on the dark system surface; coral is reserved for
 * danger/SOS so it is not used here.
 */
type NowNextProps = {
  /** e.g. "Now: Artist" or "Up next: Artist". */
  title: string;
  /** e.g. "Main Stage · until 9:45" or "in 25m". */
  subtitle: string;
};

// Brand aqua token (packages/shared/src/tokens/colors.ts colors.accent.aqua).
// expo-widgets compiles this at build time, so we use a literal that mirrors
// the token rather than importing at runtime.
const AQUA = '#00e8d0';

const NowNextActivity = (props: NowNextProps, _environment: LiveActivityEnvironment) => {
  'widget';

  return {
    // Lock Screen / banner.
    banner: (
      <HStack modifiers={[padding({ all: 14 })]}>
        <Image systemName="music.note" color={AQUA} />
        <VStack modifiers={[padding({ leading: 10 })]}>
          <Text modifiers={[font({ weight: 'bold', size: 16 }), foregroundStyle(AQUA)]}>{props.title}</Text>
          <Text modifiers={[font({ size: 13 })]}>{props.subtitle}</Text>
        </VStack>
        <Spacer />
      </HStack>
    ),
    // Dynamic Island — compact.
    compactLeading: <Image systemName="music.note" color={AQUA} />,
    compactTrailing: <Text modifiers={[font({ size: 12 }), foregroundStyle(AQUA)]}>{props.title}</Text>,
    minimal: <Image systemName="music.note" color={AQUA} />,
    // Dynamic Island — expanded.
    expandedLeading: <Image systemName="music.note" color={AQUA} modifiers={[padding({ all: 8 })]} />,
    expandedTrailing: <Text modifiers={[font({ size: 13 }), padding({ all: 8 })]}>{props.subtitle}</Text>,
    expandedCenter: (
      <Text modifiers={[font({ weight: 'bold', size: 15 }), foregroundStyle(AQUA), padding({ all: 8 })]}>
        {props.title}
      </Text>
    ),
  };
};

export default createLiveActivity('NowNextActivity', NowNextActivity);

// ---------------------------------------------------------------------------
// Home-screen widget layout (systemSmall + systemMedium).
//
// Uses the same NowNextProps shape as the Live Activity so a single
// updateSnapshot({ title, body }) call in useOngoingNotification keeps both
// surfaces in sync. The name must match the `widgets[].name` entry in
// app.json ("NowNextActivity") — expo-widgets routes by name string at
// build time, so the Live Activity factory and the Widget instance can share
// the same name without conflict.
// ---------------------------------------------------------------------------

const NowNextWidget = (props: NowNextProps, env: WidgetEnvironment) => {
  'widget';

  const isSmall = env.widgetFamily === 'systemSmall';

  if (isSmall) {
    // systemSmall (2×2): stacked icon → title → subtitle.
    return (
      <VStack modifiers={[padding({ all: 14 })]}>
        <Image systemName="music.note" color={AQUA} modifiers={[padding({ bottom: 6 })]} />
        <Text modifiers={[font({ weight: 'bold', size: 14 }), foregroundStyle(AQUA)]}>{props.title}</Text>
        <Text modifiers={[font({ size: 12 })]}>{props.subtitle}</Text>
      </VStack>
    );
  }

  // systemMedium (4×2): icon left, text right — mirrors the Live Activity banner.
  return (
    <HStack modifiers={[padding({ all: 14 })]}>
      <Image systemName="music.note" color={AQUA} />
      <VStack modifiers={[padding({ leading: 10 })]}>
        <Text modifiers={[font({ weight: 'bold', size: 16 }), foregroundStyle(AQUA)]}>{props.title}</Text>
        <Text modifiers={[font({ size: 13 })]}>{props.subtitle}</Text>
      </VStack>
      <Spacer />
    </HStack>
  );
};

export const NowNextWidgetInstance = createWidget<NowNextProps>('NowNextActivity', NowNextWidget);
