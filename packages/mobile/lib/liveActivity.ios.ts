import { NowNextActivityFactory } from '../widgets/NowNextActivity';

export interface LiveActivityContent {
  title: string;
  body: string;
  endsAt?: string | null;
}

/** Start one Live Activity, or update the surviving instance after relaunch. */
export async function startOrUpdateLiveActivity(content: LiveActivityContent): Promise<void> {
  try {
    const props = {
      title: content.title,
      subtitle: content.body,
      endsAt: content.endsAt ?? null,
    };
    const existing = NowNextActivityFactory.getInstances();
    if (existing.length > 0) {
      // Recover one survivor after relaunch and self-heal any duplicates left
      // by a prior interrupted start.
      await existing[0]!.update(props);
      await Promise.all(existing.slice(1).map((activity) => activity.end('immediate')));
    } else {
      NowNextActivityFactory.start(props, 'festie://festival-mode');
    }
  } catch {
    // Glanceable status must never make the main app fail.
  }
}

/** End every recovered instance so relaunches cannot leave stale activities. */
export async function endLiveActivity(): Promise<void> {
  try {
    await Promise.all(NowNextActivityFactory.getInstances().map((activity) => activity.end('immediate')));
  } catch {
    /* no-op */
  }
}
