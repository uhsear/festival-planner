import React, { useState } from 'react';
import { useAuthStore } from '@festie/shared';
import { useNavigate } from '@tanstack/react-router';
import AdminLayout from '../components/admin/AdminLayout';
import AdminDashboard from '../components/admin/AdminDashboard';
import AdminFestivals from '../components/admin/AdminFestivals';
import AdminUsers from '../components/admin/AdminUsers';
import AdminCrews from '../components/admin/AdminCrews';
import AdminAudit from '../components/admin/AdminAudit';
import AdminAnalytics from '../components/admin/AdminAnalytics';

type AdminTab = 'dashboard' | 'festivals' | 'users' | 'crews' | 'audit' | 'analytics';

export default function AdminPanel() {
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
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'festivals', label: 'Festivals', icon: '🎪' },
    { id: 'users', label: 'Users', icon: '👥' },
    { id: 'crews', label: 'Crews', icon: '👫' },
    { id: 'audit', label: 'Audit Log', icon: '📋' },
    { id: 'analytics', label: 'Analytics', icon: '📈' },
  ] as Array<{ id: AdminTab; label: string; icon: string }>;

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
      {renderContent()}
    </AdminLayout>
  );
}
