/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */

/**
 * Admin crews tab — list all crews, expand to see members, remove/delete actions
 */

import { adminState } from '../../app/state.js?v=1776342458439';
import { h } from '../../app/dom.js?v=1776342458439';

// ── Helpers ────────────────────────────────────────────────────

function spinner(text = 'Loading...') {
  return h('div', { className: 'admin-loading', role: 'status', 'aria-live': 'polite' },
    h('div', { className: 'admin-spinner', 'aria-hidden': 'true' }),
    h('span', {}, text),
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Load ──────────────────────────────────────────────────────

export async function loadAdminCrews(deps) {
  const { adminApi, toast } = deps;
  try {
    adminState.crewsData = await adminApi('/admin/crews');
    adminState.crewsLoaded = true;
    adminState.expandedCrew = adminState.expandedCrew || null;
    adminState.crewMembers = adminState.crewMembers || {};
  } catch (e) {
    toast('Failed to load crews', 'error');
    adminState.crewsData = null;
  }
}

async function loadCrewMembers(crewId, deps) {
  const { adminApi, toast } = deps;
  try {
    const members = await adminApi(`/admin/crews/${crewId}/members`);
    if (!adminState.crewMembers) adminState.crewMembers = {};
    adminState.crewMembers[crewId] = members;
  } catch (e) {
    toast('Failed to load members', 'error');
  }
}

// ── Render ─────────────────────────────────────────────────────

export function renderAdminCrews(panel, deps) {
  const { adminApi, toast, rerender, styledConfirm } = deps;
  const crews = adminState.crewsData;

  // Promote panel to a labeled region for screen readers
  panel.setAttribute?.('role', 'region');
  panel.setAttribute?.('aria-label', 'Crew management');

  if (!crews) {
    if (!adminState.crewsLoaded) {
      loadAdminCrews(deps).then(() => rerender());
      panel.appendChild(spinner('Loading crews...'));
      return;
    }
    panel.appendChild(h('p', { style: { color: 'var(--text-muted)', textAlign: 'center', padding: '20px' } }, 'Crew data unavailable.'));
    return;
  }

  // Summary
  const totalMembers = crews.reduce((sum, c) => sum + parseInt(c.memberCount || 0, 10), 0);
  const summary = h('div', { className: 'admin-crew-summary', role: 'status', 'aria-live': 'polite' },
    h('span', { className: 'admin-crew-stat' }, `${crews.length} crew${crews.length !== 1 ? 's' : ''}`),
    h('span', { className: 'admin-crew-stat' }, `${totalMembers} total member${totalMembers !== 1 ? 's' : ''}`),
  );
  panel.appendChild(summary);

  if (crews.length === 0) {
    panel.appendChild(h('p', { style: { color: 'var(--text-muted)', textAlign: 'center', padding: '20px' } }, 'No crews found.'));
    return;
  }

  // Crew list
  const list = h('div', { className: 'admin-crew-list', role: 'list', 'aria-label': 'Crews' });

  for (const crew of crews) {
    const isExpanded = adminState.expandedCrew === crew.id;
    const memberCount = parseInt(crew.memberCount || 0, 10);
    const headerId = `admin-crew-header-${crew.id}`;
    const detailId = `admin-crew-detail-${crew.id}`;

    const row = h('div', { className: 'admin-crew-row' + (isExpanded ? ' expanded' : ''), role: 'listitem' });

    // Header (clickable to expand)
    const header = h('div', {
      className: 'admin-crew-header',
      id: headerId,
      role: 'button',
      tabindex: '0',
      'aria-expanded': isExpanded ? 'true' : 'false',
      'aria-controls': detailId,
      'aria-label': `${crew.name}, ${memberCount} member${memberCount !== 1 ? 's' : ''}. ${isExpanded ? 'Collapse' : 'Expand'} details.`,
      onclick: async () => {
        if (adminState.expandedCrew === crew.id) {
          adminState.expandedCrew = null;
        } else {
          adminState.expandedCrew = crew.id;
          if (!adminState.crewMembers?.[crew.id]) {
            await loadCrewMembers(crew.id, deps);
          }
        }
        rerender();
      },
    },
      h('div', { className: 'admin-crew-info' },
        h('span', { className: 'admin-crew-name' }, crew.name),
        h('span', { className: 'admin-crew-meta' },
          `${crew.festivalName || 'Unknown festival'} · ${memberCount}/${crew.maxMembers || '∞'} members · Created ${formatDate(crew.createdAt)}`
        ),
      ),
      h('div', { className: 'admin-crew-actions' },
        h('span', { className: 'admin-crew-expand-icon', 'aria-hidden': 'true' }, isExpanded ? '▾' : '▸'),
      ),
    );
    row.appendChild(header);

    // Detail section
    if (isExpanded) {
      const detail = h('div', { className: 'admin-crew-detail', id: detailId, role: 'region', 'aria-labelledby': headerId });

      // Crew metadata
      const meta = h('div', { className: 'admin-crew-meta-grid' });
      meta.appendChild(h('div', { className: 'admin-meta-item' },
        h('span', { className: 'admin-meta-label' }, 'Creator'),
        h('span', { className: 'admin-meta-value' }, crew.creatorUsername || '—'),
      ));
      meta.appendChild(h('div', { className: 'admin-meta-item' },
        h('span', { className: 'admin-meta-label' }, 'Invite Code'),
        h('span', { className: 'admin-meta-value admin-mono' }, crew.inviteCode || '—'),
      ));
      if (crew.homeBaseLocation) {
        meta.appendChild(h('div', { className: 'admin-meta-item' },
          h('span', { className: 'admin-meta-label' }, 'Home Base'),
          h('span', { className: 'admin-meta-value' }, `${crew.homeBaseLocation}${crew.homeBaseTime ? ' @ ' + crew.homeBaseTime : ''}`),
        ));
      }
      detail.appendChild(meta);

      // Members table
      const members = adminState.crewMembers?.[crew.id];
      if (!members) {
        detail.appendChild(spinner('Loading members...'));
      } else if (members.length === 0) {
        detail.appendChild(h('p', { style: { color: 'var(--text-muted)', fontSize: '13px' } }, 'No members.'));
      } else {
        const table = h('div', { className: 'admin-crew-members', role: 'table', 'aria-label': `Members of ${crew.name}` });
        const thead = h('div', { className: 'admin-crew-member-header', role: 'row' },
          h('span', { role: 'columnheader' }, 'User'),
          h('span', { role: 'columnheader' }, 'Role'),
          h('span', { role: 'columnheader' }, 'Joined'),
          h('span', { role: 'columnheader', 'aria-label': 'Actions' }, ''),
        );
        table.appendChild(thead);

        for (const m of members) {
          const mRow = h('div', { className: 'admin-crew-member-row', role: 'row' },
            h('span', { className: 'admin-crew-member-name', role: 'cell' }, m.username || m.userId),
            h('span', { className: 'admin-crew-member-role badge-' + (m.role || 'member'), role: 'cell' }, m.role || 'member'),
            h('span', { className: 'admin-crew-member-date', role: 'cell' }, formatDate(m.joinedAt)),
            h('span', { role: 'cell' },
              h('button', {
                className: 'btn btn-danger btn-xs',
                'aria-label': `Remove ${m.username || m.userId} from ${crew.name}`,
                onclick: async (e) => {
                  e.stopPropagation();
                  const ok = await styledConfirm(`Remove ${m.username} from ${crew.name}?`);
                  if (!ok) return;
                  try {
                    await adminApi(`/admin/crews/${crew.id}/members/${m.userId}`, { method: 'DELETE' });
                    toast(`Removed ${m.username}`, 'success');
                    await loadCrewMembers(crew.id, deps);
                    await loadAdminCrews(deps);
                    rerender();
                  } catch (err) {
                    toast(`Failed: ${err.message}`, 'error');
                  }
                },
              }, 'Remove'),
            ),
          );
          table.appendChild(mRow);
        }
        detail.appendChild(table);
      }

      // Delete crew button
      detail.appendChild(h('div', { style: { marginTop: '12px', textAlign: 'right' } },
        h('button', {
          className: 'btn btn-danger btn-sm',
          'aria-label': `Delete crew ${crew.name}`,
          onclick: async (e) => {
            e.stopPropagation();
            const ok = await styledConfirm(`Delete crew "${crew.name}" and remove all members? This cannot be undone.`);
            if (!ok) return;
            try {
              await adminApi(`/admin/crews/${crew.id}`, { method: 'DELETE' });
              toast(`Deleted crew "${crew.name}"`, 'success');
              adminState.expandedCrew = null;
              await loadAdminCrews(deps);
              rerender();
            } catch (err) {
              toast(`Failed: ${err.message}`, 'error');
            }
          },
        }, 'Delete Crew'),
      ));

      row.appendChild(detail);
    }

    list.appendChild(row);
  }
  panel.appendChild(list);

  // Refresh
  panel.appendChild(h('div', { style: { textAlign: 'center', marginTop: '16px' } },
    h('button', { className: 'btn btn-ghost btn-sm', 'aria-label': 'Refresh crews list', onclick: async () => {
      adminState.crewsLoaded = false;
      adminState.crewMembers = {};
      await loadAdminCrews(deps);
      rerender();
    } }, 'Refresh Crews'),
  ));
}
