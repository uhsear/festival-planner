/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */

/**
 * Admin users tab — search, sort, role management, delete, password reset
 */

import { S, adminState } from '../../app/state.js?v=1776342458439';
import { $, h } from '../../app/dom.js?v=1776342458439';

// ── Data loading ───────────────────────────────────────────────

export async function loadAdminUsers(deps) {
  const { adminApi, toast } = deps;
  try {
    adminState._usersLoading = true;
    const search = adminState.userSearch || '';
    const url = search ? `/admin/users?search=${encodeURIComponent(search)}` : '/admin/users';
    adminState.adminUsers = await adminApi(url);
    adminState._usersLoading = false;
  } catch (e) {
    toast('Failed to load users', 'error');
    adminState.adminUsers = [];
    adminState._usersLoading = false;
  }
}

// ── User list rendering ────────────────────────────────────────

export function renderAdminUserList(panel, deps) {
  const { adminApi, toast, render, styledConfirm, rerender } = deps;
  const users = adminState.adminUsers || [];

  // Search bar
  const searchRow = h('div', { className: 'admin-search-row', role: 'region', 'aria-label': 'User management' });
  const searchInput = h('input', {
    type: 'text',
    className: 'admin-search-input',
    placeholder: 'Search users by name or email...',
    value: adminState.userSearch || '',
  });
  let searchTimer = null;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      adminState.userSearch = e.target.value.trim();
      await loadAdminUsers(deps);
      rerender();
    }, 300);
  });
  searchRow.appendChild(searchInput);
  panel.appendChild(searchRow);

  // Sort controls
  const sortRow = h('div', { className: 'admin-sort-row' });
  const sortOptions = [
    { value: 'username', label: 'Name' },
    { value: 'createdAt', label: 'Joined' },
    { value: 'totalPicks', label: 'Picks' },
  ];
  const currentSort = adminState._userSort || 'username';
  const currentDir = adminState._userSortDir || 'asc';
  sortOptions.forEach(opt => {
    const isActive = currentSort === opt.value;
    const arrow = isActive ? (currentDir === 'asc' ? ' ↑' : ' ↓') : '';
    sortRow.appendChild(h('button', {
      className: 'admin-sort-btn' + (isActive ? ' active' : ''),
      onclick: () => {
        if (currentSort === opt.value) {
          adminState._userSortDir = currentDir === 'asc' ? 'desc' : 'asc';
        } else {
          adminState._userSort = opt.value;
          adminState._userSortDir = opt.value === 'username' ? 'asc' : 'desc';
        }
        rerender();
      },
    }, opt.label + arrow));
  });
  panel.appendChild(sortRow);

  // Apply sort
  const sortedUsers = [...users].sort((a, b) => {
    const dir = currentDir === 'asc' ? 1 : -1;
    if (currentSort === 'username') return dir * a.username.localeCompare(b.username);
    if (currentSort === 'createdAt') return dir * (new Date(a.createdAt) - new Date(b.createdAt));
    if (currentSort === 'totalPicks') return dir * (a.totalPicks - b.totalPicks);
    return 0;
  });

  // Count
  panel.appendChild(
    h('div', { className: 'admin-user-count' },
      `${users.length} user${users.length !== 1 ? 's' : ''}${adminState.userSearch ? ` matching "${adminState.userSearch}"` : ''}`
    )
  );

  if (users.length === 0) {
    panel.appendChild(
      h('p', { style: { color: 'var(--text-muted)', textAlign: 'center', padding: '20px' } },
        adminState.userSearch ? 'No users match your search.' : 'No users registered yet.'
      )
    );
    return;
  }

  sortedUsers.forEach(u => {
    const row = h('div', { className: 'admin-user-row', 'data-testid': 'admin-user-row', 'data-user-id': u.id });
    const info = h('div', { className: 'user-info' });

    const nameRow = h('div', { className: 'flex items-center gap-2' });
    nameRow.appendChild(h('div', { className: 'username' }, u.username));
    (u.roles || []).forEach(role => {
      if (role === 'user') return;
      nameRow.appendChild(h('span', { className: `admin-role-badge admin-role-${role}` }, role));
    });
    info.appendChild(nameRow);
    info.appendChild(
      h('div', { className: 'user-meta' },
        `${u.profileCount} profile${u.profileCount !== 1 ? 's' : ''} · ${u.totalPicks} pick${u.totalPicks !== 1 ? 's' : ''} · Joined ${new Date(u.createdAt).toLocaleDateString()}`
      )
    );
    row.appendChild(info);

    const actions = h('div', { className: 'user-actions' });
    const isAdmin = (u.roles || []).includes('admin');
    const isSelf = u.id === S.user?.id;

    if (!isSelf) {
      actions.appendChild(
        h('button', {
          className: `btn btn-sm ${isAdmin ? 'btn-warning' : 'btn-ghost'}`,
          title: isAdmin ? 'Revoke admin role' : 'Grant admin role',
          onclick: async () => {
            const action = isAdmin ? 'revoke' : 'grant';
            const confirmed = await styledConfirm(
              isAdmin ? `Revoke admin role from "${u.username}"?` : `Grant admin role to "${u.username}"?`,
              { confirmLabel: isAdmin ? 'Revoke' : 'Grant', confirmClass: isAdmin ? 'btn btn-warning' : 'btn btn-primary' }
            );
            if (!confirmed) return;
            try {
              const btn = actions.querySelector(`[title="${isAdmin ? 'Revoke admin role' : 'Grant admin role'}"]`);
              if (btn) { btn.disabled = true; btn.textContent = '...'; }
              if (action === 'grant') await adminApi(`/admin/users/${u.id}/roles`, { method: 'POST', body: { role: 'admin' } });
              else await adminApi(`/admin/users/${u.id}/roles/admin`, { method: 'DELETE' });
              toast(`${action === 'grant' ? 'Granted' : 'Revoked'} admin for ${u.username}`, 'success');
              await loadAdminUsers(deps);
              rerender();
            } catch (e) {
              toast('Failed: ' + e.message, 'error');
            }
          },
        }, isAdmin ? 'Revoke Admin' : 'Make Admin')
      );
    } else {
      actions.appendChild(h('span', { className: 'admin-role-badge admin-role-self' }, 'You'));
    }

    actions.appendChild(
      h('button', {
        className: 'btn btn-ghost btn-sm',
        'data-testid': 'admin-reset-user',
        onclick: () => _showResetPassword(u, deps),
      }, 'Reset PW')
    );

    if (!isSelf) {
      actions.appendChild(
        h('button', {
          className: 'btn btn-danger btn-sm',
          'data-testid': 'admin-delete-user',
          onclick: async () => {
            const confirmed = await styledConfirm(
              `Delete user "${u.username}" and all their profiles? This cannot be undone.`,
              { confirmLabel: 'Delete User', confirmClass: 'btn btn-danger' }
            );
            if (!confirmed) return;
            try {
              await adminApi('/admin/users/' + u.id, { method: 'DELETE' });
              toast(`User ${u.username} deleted`);
              await loadAdminUsers(deps);
              rerender();
            } catch (e) {
              toast('Failed: ' + e.message, 'error');
            }
          },
        }, 'Delete')
      );
    }

    row.appendChild(actions);
    panel.appendChild(row);
  });
}

// ── Reset password modal ───────────────────────────────────────

function _showResetPassword(user, deps) {
  const { adminApi, toast, rerender } = deps;
  const ov = h('div', { className: 'admin-login-overlay open' });
  const box = h('div', { className: 'admin-login-box' });
  box.appendChild(h('h2', {}, 'RESET PASSWORD'));
  box.appendChild(h('p', {}, `Set new password for ${user.username}`));
  const err = h('div', { className: 'login-error', id: 'rpError', role: 'alert', 'aria-live': 'assertive' }, '\u00A0');
  box.appendChild(err);
  const pi = h('input', { type: 'password', placeholder: 'New Password', id: 'rpNewPass' });
  const doReset = async () => {
    const pass = $('#rpNewPass')?.value;
    const errEl = $('#rpError');
    if (!pass || pass.length < 8) { if (errEl) errEl.textContent = 'Password must be at least 8 characters'; return; }
    try {
      await adminApi('/admin/users/' + user.id + '/reset-password', { method: 'PUT', body: { newPassword: pass } });
      ov.remove();
      toast(`Password reset for ${user.username}`, 'success');
      await loadAdminUsers(deps);
      rerender();
    } catch (e) {
      if (errEl) errEl.textContent = e.message || 'Failed';
    }
  };
  pi.addEventListener('keydown', e => { if (e.key === 'Enter') doReset(); });
  box.appendChild(h('div', { className: 'form-row' }, pi));
  const br = h('div', { className: 'btn-row' });
  br.appendChild(h('button', { className: 'btn btn-ghost', onclick: () => ov.remove() }, 'Cancel'));
  br.appendChild(h('button', { className: 'btn btn-primary', onclick: doReset }, 'Reset'));
  box.appendChild(br);
  ov.appendChild(box);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  requestAnimationFrame(() => pi.focus());
}
