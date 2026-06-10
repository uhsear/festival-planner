import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

/**
 * Festie "Now & Next" iOS Live Activity (SDK 56 expo-widgets).
 *
 * Presents the SAME on-device model that powers the Android ongoing
 * notification (`buildOngoingNotificationModel` → { title, body }) as a Lock
 * Screen banner + Dynamic Island. The layout is authored in @expo/ui/swift-ui
 * and compiled to SwiftUI by expo-widgets at build time — no hand-written Swift.
 *
 * Driven from JS via lib/liveActivity.ts (start/update/end). Brand: aqua accent
 * on the dark system surface; coral is reserved for danger/SOS so it's not used
 * here.
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
