import React, { lazy, Suspense, useState } from 'react';
import { useAuthStore } from '@festie/shared';
import { useNavigate } from '@tanstack/react-router';
import AdminLayout from '../components/admin/AdminLayout';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { LayoutDashboard, Tent, Users, UsersRound, ClipboardList, TrendingUp } from 'lucide-react';

const AdminDashboard = lazy(() => import('../components/admin/AdminDashboard'));
const AdminFestivals = lazy(() => import('../components/admin/AdminFestivals'));
const AdminUsers = lazy(() => import('../components/admin/AdminUsers'));
const AdminCrews = lazy(() => import('../components/admin/AdminCrews'));
const AdminAudit = lazy(() => import('../components/admin/AdminAudit'));
const AdminAnalytics = lazy(() => import('../components/admin/AdminAnalytics'));

type AdminTab = 'dashboard' | 'festivals' | 'users' | 'crews' | 'audit' | 'analytics';

export default function AdminPanel() {
  return (
    <RenderErrorBoundary name="admin">
      <AdminPanelInner />
    </RenderErrorBoundary>
  );
}

function AdminPanelInner() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');

  if (!user?.isAdmin) {
    return (
      <div className="flex-center min-h-dvh flex-col gap-4">
        <div className="text-lg text-accent-coral">Access Denied</div>
        <button
          type="button"
          onClick={() => navigate({ to: '/cards' })}
          className="px-4 py-2 min-h-11 rounded-lg bg-accent-aqua text-bg-primary hover:opacity-80 transition-opacity"
        >
          Go Back
        </button>
      </div>
    );
  }

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard /> },
    { id: 'festivals', label: 'Festivals', icon: <Tent /> },
    { id: 'users', label: 'Users', icon: <Users /> },
    { id: 'crews', label: 'Crews', icon: <UsersRound /> },
    { id: 'audit', label: 'Audit Log', icon: <ClipboardList /> },
    { id: 'analytics', label: 'Analytics', icon: <TrendingUp /> },
  ] as Array<{ id: AdminTab; label: string; icon: React.ReactNode }>;

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <AdminDashboard />;
      case 'festivals':
        return <AdminFestivals />;
      case 'users':
        return <AdminUsers />;
      case 'crews':
        return <AdminCrews />;
      case 'audit':
        return <AdminAudit />;
      case 'analytics':
        return <AdminAnalytics />;
      default:
        return null;
    }
  };

  return (
    <AdminLayout
      title="Admin Panel"
      description="Manage system, festivals, users, and view analytics"
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab as AdminTab)}
      tabs={tabs}
    >
      <Suspense fallback={<div className="flex-center p-8 text-text-muted">Loading…</div>}>{renderContent()}</Suspense>
    </AdminLayout>
  );
}
