import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared/stores/authStore';
import ProfileSection from '../components/account/ProfileSection';
import PasswordSection from '../components/account/PasswordSection';
import NotificationSection from '../components/account/NotificationSection';
import NotificationPrefsSection from '../components/account/NotificationPrefsSection';
import DangerZone from '../components/account/DangerZone';
import Avatar from '../components/ui/Avatar';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';

export default function AccountPage() {
  return (
    <RenderErrorBoundary name="account">
      <AccountPageInner />
    </RenderErrorBoundary>
  );
}

/**
 * Account screen — mirrors packages/mobile/app/(tabs)/account.tsx.
 *
 * Renders the page as labeled sections (a small uppercase `label`-role header
 * above each restyled Card body) and leads with an identity header block
 * (avatar + name + @handle + email), matching the mobile layout. The section
 * sub-components own their own Card chrome, so the page wrapper only supplies
 * the labels, identity card, and vertical rhythm. Auth gate is unchanged.
 */
function AccountPageInner() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  if (!user) {
    navigate({ to: '/login' });
    return null;
  }

  const displayName = user.name ?? user.username ?? 'Account';

  return (
    <div className="bg-bg-primary pb-6">
      <div className="max-w-lg mx-auto px-4 pt-3 pb-6 space-y-4">
        <h1 className="text-xl font-display font-bold text-text-primary">Account Settings</h1>

        {/* Identity */}
        <section className="flex items-center gap-4 p-4 rounded-xl bg-bg-card border border-border">
          <Avatar name={displayName} image={user.avatar ?? user.avatarUrl} size="lg" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-lg font-semibold text-text-primary truncate">{displayName}</p>
            {user.username ? <p className="text-sm text-accent-aqua truncate">@{user.username}</p> : null}
            {user.email ? <p className="text-xs text-text-secondary truncate">{user.email}</p> : null}
          </div>
        </section>

        {/* Profile */}
        <Section label="Profile">
          <ProfileSection user={user} />
        </Section>

        {/* Security */}
        <Section label="Security">
          <PasswordSection />
        </Section>

        {/* Preferences */}
        <Section label="Preferences">
          <NotificationSection />
          <NotificationPrefsSection />
        </Section>

        {/* Legal */}
        <Section label="Legal">
          <a
            href="/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-1 text-sm text-accent-aqua hover:underline"
          >
            Privacy Policy
          </a>
        </Section>

        {/* Danger Zone */}
        <Section label="Danger Zone">
          <DangerZone />
        </Section>
      </div>
    </div>
  );
}

/**
 * Labeled section wrapper: a small uppercase `label`-role header above the
 * section body. Mirrors the mobile `sectionLabel` type style.
 */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="px-1 text-xs font-semibold text-text-secondary uppercase tracking-[.8px]">{label}</p>
      {children}
    </div>
  );
}
