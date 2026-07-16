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
  /** ISO target time rendered by SwiftUI as a native, live-updating timer. */
  endsAt?: string | null;
};

const NowNextActivity = (props: NowNextProps, _environment: LiveActivityEnvironment) => {
  'widget';

  // Widget-marked functions run in an isolated runtime and cannot reference
  // module-scope values. Keep the mirrored brand token inside the function.
  const aqua = '#00e8d0';
  const timer = props.endsAt ? new Date(props.endsAt) : null;

  return {
    // Lock Screen / banner.
    banner: (
      <HStack modifiers={[padding({ all: 14 })]}>
        <Image systemName="music.note" color={aqua} />
        <VStack modifiers={[padding({ leading: 10 })]}>
          <Text modifiers={[font({ weight: 'bold', size: 16 }), foregroundStyle(aqua)]}>{props.title}</Text>
          <Text modifiers={[font({ size: 13 })]}>{props.subtitle}</Text>
          {timer ? <Text date={timer} dateStyle="timer" modifiers={[font({ weight: 'bold', size: 13 })]} /> : null}
        </VStack>
        <Spacer />
      </HStack>
    ),
    // Dynamic Island — compact.
    compactLeading: <Image systemName="music.note" color={aqua} />,
    compactTrailing: timer ? (
      <Text date={timer} dateStyle="timer" modifiers={[font({ size: 12 }), foregroundStyle(aqua)]} />
    ) : (
      <Text modifiers={[font({ size: 12 }), foregroundStyle(aqua)]}>Festie</Text>
    ),
    minimal: <Image systemName="music.note" color={aqua} />,
    // Dynamic Island — expanded.
    expandedLeading: <Image systemName="music.note" color={aqua} modifiers={[padding({ all: 8 })]} />,
    expandedTrailing: (
      <VStack modifiers={[padding({ all: 8 })]}>
        <Text modifiers={[font({ size: 13 })]}>{props.subtitle}</Text>
        {timer ? <Text date={timer} dateStyle="timer" modifiers={[font({ weight: 'bold', size: 13 })]} /> : null}
      </VStack>
    ),
    expandedCenter: (
      <Text modifiers={[font({ weight: 'bold', size: 15 }), foregroundStyle(aqua), padding({ all: 8 })]}>
        {props.title}
      </Text>
    ),
  };
};

export const NowNextActivityFactory = createLiveActivity<NowNextProps>('NowNextLiveActivity', NowNextActivity);
export default NowNextActivityFactory;

// ---------------------------------------------------------------------------
// Home-screen widget layout (systemSmall + systemMedium).
//
// Uses the same NowNextProps shape as the Live Activity so a single
// updateSnapshot({ title, subtitle, endsAt }) call in useOngoingNotification
// keeps both surfaces in sync. This home-screen widget name matches app.json;
// the Live Activity uses its own runtime-only name above.
// ---------------------------------------------------------------------------

const NowNextWidget = (props: NowNextProps, env: WidgetEnvironment) => {
  'widget';

  const aqua = '#00e8d0';
  const isSmall = env.widgetFamily === 'systemSmall';

  if (isSmall) {
    // systemSmall (2×2): stacked icon → title → subtitle.
    return (
      <VStack modifiers={[padding({ all: 14 })]}>
        <Image systemName="music.note" color={aqua} modifiers={[padding({ bottom: 6 })]} />
        <Text modifiers={[font({ weight: 'bold', size: 14 }), foregroundStyle(aqua)]}>{props.title}</Text>
        <Text modifiers={[font({ size: 12 })]}>{props.subtitle}</Text>
      </VStack>
    );
  }

  // systemMedium (4×2): icon left, text right — mirrors the Live Activity banner.
  return (
    <HStack modifiers={[padding({ all: 14 })]}>
      <Image systemName="music.note" color={aqua} />
      <VStack modifiers={[padding({ leading: 10 })]}>
        <Text modifiers={[font({ weight: 'bold', size: 16 }), foregroundStyle(aqua)]}>{props.title}</Text>
        <Text modifiers={[font({ size: 13 })]}>{props.subtitle}</Text>
      </VStack>
      <Spacer />
    </HStack>
  );
};

export const NowNextWidgetInstance = createWidget<NowNextProps>('NowNextActivity', NowNextWidget);
