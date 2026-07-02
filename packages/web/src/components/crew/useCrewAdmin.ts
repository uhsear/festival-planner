import { useState, useCallback } from 'react';
import { api } from '@festie/shared/services';
import { useCrewStore } from '@festie/shared/stores';
import type { User } from '@festie/shared/types';
import type { ToastType } from '../../lib/toastContext';

/**
 * Encapsulates admin-role detection and force-add-member logic.
 */
export function useCrewAdmin(
  user: User | null,
  activeCrewId: string | undefined,
  toast: (msg: string, type: ToastType) => void,
) {
  const selectCrew = useCrewStore((state) => state.selectCrew);
  const forceAddMember = useCrewStore((state) => state.forceAddMember);

  const isAdmin = user?.isAdmin ?? false;
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminAddBusy, setAdminAddBusy] = useState(false);

  const submitForceAdd = useCallback(async (query: string) => {
    if (!activeCrewId) return;
    setAdminAddBusy(true);
    try {
      const users = await api.get<Array<{ id: string; username: string; email: string | null }>>(
        `/admin/users?search=${encodeURIComponent(query)}`,
      );
      if (!users || users.length === 0) { toast('No matching user found', 'error'); return; }
      const exact = users.find((u) => u.username.toLowerCase() === query.toLowerCase());
      const target = exact || users[0]!;
      if (!exact && users.length > 1) {
        const confirmed = window.confirm(`Found ${users.length} users. Add "${target.username}"?`);
        if (!confirmed) return;
      }
      await forceAddMember(activeCrewId, target.id);
      await selectCrew(activeCrewId);
      toast(`Added ${target.username}`, 'success');
      setAdminOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed';
      if (/already/i.test(msg)) toast('User is already in this crew', 'info');
      else toast(msg, 'error');
    } finally { setAdminAddBusy(false); }
  }, [activeCrewId, forceAddMember, selectCrew, toast]);

  const handleForceAdd = useCallback(() => setAdminOpen(true), []);

  return {
    isAdmin,
    adminOpen,
    setAdminOpen,
    adminAddBusy,
    submitForceAdd,
    handleForceAdd,
  };
}
