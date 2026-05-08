import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared/stores/authStore';
import ProfileSection from '../components/account/ProfileSection';
import PasswordSection from '../components/account/PasswordSection';
import NotificationSection from '../components/account/NotificationSection';
import DangerZone from '../components/account/DangerZone';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';

export default function AccountPage() {
  return (
    <RenderErrorBoundary name="account">
      <AccountPageInner />
    </RenderErrorBoundary>
  );
}

function AccountPageInner() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  if (!user) {
    navigate({ to: '/login' });
    return null;
  }

  return (
    <div className="bg-bg-primary pb-20">
      <div className="max-w-lg mx-auto px-4 pt-3 pb-6 space-y-4">
        <h1 className="text-xl font-display font-bold text-text-primary">
          Account Settings
        </h1>

        <ProfileSection user={user} />
        <PasswordSection />
        <NotificationSection />
        <DangerZone />
      </div>
    </div>
  );
}
