/**
 * Non-iOS Live Activity boundary. Metro resolves liveActivity.ios.ts on iOS;
 * Android and web keep these calls as safe no-ops without loading SwiftUI-only
 * widget code into their bundles.
 */
export interface LiveActivityContent {
  title: string;
  body: string;
  endsAt?: string | null;
}

export async function startOrUpdateLiveActivity(_content: LiveActivityContent): Promise<void> {}

export async function endLiveActivity(): Promise<void> {}
