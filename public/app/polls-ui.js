/**
 * Crew Polls — render and manage crew polls
 * Exported functions:
 *   - renderPollsTab(deps)
 */

import { S } from '../app/state.js?v=1776342458439';
import { h } from '../app/dom.js?v=1776342458439';
import { getInitials, getAvatarColor } from '../app/helpers.js?v=1776342458439';

/**
 * renderPollsTab(deps)
 * Returns a DOM element for the polls tab
 */
export function renderPollsTab(deps) {
  const { toast } = deps;

  const container = h('div', { className: 'polls-tab' });

  if (!S.activeCrew) {
    container.appendChild(h('p', {}, 'No crew selected'));
    return container;
  }

  // State
  let polls = [];
  let loading = true;
  const createFormOpen = { value: false };

  async function loadPolls() {
    loading = true;
    render();
    try {
      const res = await (await fetch(`/api/v1/crews/${S.activeCrew.id}/polls`, { credentials: 'same-origin' })).json();
      if (!res.error) {
        polls = res.data?.polls || [];
        // Update crew tab badge count for open polls
        S._openPollsCount = polls.filter(p => !p.closed).length;
      }
    } catch (err) {
      toast('Couldn\u2019t load polls. Pull to refresh.', 'error');
    }
    loading = false;
    render();
  }

  async function createPoll(question, options) {
    try {
      const res = await (await fetch(`/api/v1/crews/${S.activeCrew.id}/polls`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ question, options, closesAt: null }) })).json();
      if (!res.error) {
        createFormOpen.value = false;
        await loadPolls();
        toast('Poll created', 'success');
      }
    } catch (err) {
      toast('Couldn\u2019t create poll. Try again.', 'error');
    }
  }

  async function castVote(pollId, optionIndex) {
    try {
      const res = await (await fetch(`/api/v1/crews/${S.activeCrew.id}/polls/${pollId}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ optionIndex }) })).json();
      if (!res.error) {
        await loadPolls();
        toast('Vote recorded', 'success');
      }
    } catch (err) {
      toast('Couldn\u2019t record vote. Try again.', 'error');
    }
  }

  async function closePoll(pollId) {
    try {
      const res = await (await fetch(`/api/v1/crews/${S.activeCrew.id}/polls/${pollId}`, { method: 'DELETE', credentials: 'same-origin' })).json();
      if (!res.error) {
        await loadPolls();
        toast('Poll closed', 'success');
      }
    } catch (err) {
      toast('Couldn\u2019t close poll. Try again.', 'error');
    }
  }

  // Load polls on first render
  loadPolls();

  // Render
  function render() {
    container.replaceChildren();
    const section = h('div', { className: 'polls-section' });

    // Create button
    const btnRow = h('div', { style: { marginBottom: '15px' } });
    btnRow.appendChild(h('button', {
      className: 'btn btn-primary btn-sm',
      type: 'button',
      onclick: () => {
        createFormOpen.value = !createFormOpen.value;
        render();
      },
    }, createFormOpen.value ? 'Cancel' : 'Create Poll'));
    section.appendChild(btnRow);

    // Create form
    if (createFormOpen.value) {
      const form = h('div', { className: 'poll-create-form', style: { marginBottom: '20px', padding: '15px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' } });
      const questionInput = h('input', {
        type: 'text',
        placeholder: 'Poll question',
        style: { width: '100%', padding: '8px', marginBottom: '10px', borderRadius: '4px', border: '1px solid var(--border)' },
      });
      form.appendChild(questionInput);

      const optionsDiv = h('div', {});
      const options = ['', ''];
      for (let i = 0; i < options.length; i++) {
        const inp = h('input', {
          type: 'text',
          placeholder: `Option ${i + 1}`,
          value: options[i],
          style: { width: '100%', padding: '8px', marginBottom: '8px', borderRadius: '4px', border: '1px solid var(--border)' },
        });
        optionsDiv.appendChild(inp);
      }
      form.appendChild(optionsDiv);

      form.appendChild(h('button', {
        className: 'btn btn-primary btn-sm',
        type: 'button',
        onclick: () => {
          const q = questionInput.value.trim();
          const opts = Array.from(optionsDiv.querySelectorAll('input')).map(i => i.value.trim()).filter(Boolean);
          if (q && opts.length >= 2) {
            createPoll(q, opts);
          } else {
            toast('Need question and 2+ options', 'warning');
          }
        },
      }, 'Create'));
      section.appendChild(form);
    }

    // Polls list
    if (loading) {
      section.appendChild(h('p', {}, 'Loading...'));
    } else if (polls.length === 0) {
      section.appendChild(h('p', { style: { color: 'var(--text-secondary)' } }, 'No active polls'));
    } else {
      const listDiv = h('div', {});
      polls.forEach(poll => {
        const card = h('div', {
          className: 'poll-card',
          style: {
            padding: '15px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '10px',
          },
        });

        // Question + optional deadline badge
        card.appendChild(h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, poll.question));
        if (poll.closesAt) {
          const closesMs = new Date(poll.closesAt).getTime() - Date.now();
          const isPast = closesMs <= 0;
          let deadlineLabel;
          if (isPast) {
            deadlineLabel = 'Closed';
          } else {
            const minsLeft = Math.floor(closesMs / 60000);
            const hrsLeft = Math.floor(minsLeft / 60);
            const daysLeft = Math.floor(hrsLeft / 24);
            deadlineLabel = daysLeft > 0 ? `closes in ${daysLeft}d` : hrsLeft > 0 ? `closes in ${hrsLeft}h` : `closes in ${minsLeft}m`;
          }
          const urgentClass = !isPast && closesMs < 3600000 ? ' poll-deadline-urgent' : '';
          card.appendChild(h('div', {
            className: 'poll-deadline' + urgentClass,
            style: { fontSize: '11px', color: isPast ? 'var(--text-muted)' : closesMs < 3600000 ? 'var(--accent-amber)' : 'var(--text-secondary)', marginBottom: '10px' }
          }, isPast ? '🔒 ' + deadlineLabel : '⏳ ' + deadlineLabel));
        } else {
          card.appendChild(h('div', { style: { marginBottom: '10px' } }));
        }

        // Options with vote bars
        const votesData = poll.votes || [];
        const totalVotes = new Set(votesData.map(v => v.user_id)).size;

        poll.options.forEach((option, idx) => {
          const voteCount = votesData.filter(v => v.option === idx).length;
          const percent = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;

          const optDiv = h('div');
          const myVote = poll.votes?.find(v => v.user_id === S.user?.userId);
          const isMyVote = myVote?.option === idx;
          const optRow = h('div', {
            className: 'poll-option' + (isMyVote ? ' poll-voted' : ''),
            style: { marginBottom: '8px', cursor: 'pointer' },
            onclick: () => castVote(poll.id, idx),
            onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); castVote(poll.id, idx); } },
            role: 'button', tabindex: '0',
            'aria-label': option + ', ' + voteCount + ' votes, ' + percent + '%',
          });
          const optLabel = h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '13px' } });
          optLabel.appendChild(h('span', { style: { fontWeight: isMyVote ? '600' : '400', color: isMyVote ? 'var(--accent-aqua)' : 'var(--text-primary)' } }, (isMyVote ? '✓ ' : '') + option));
          optLabel.appendChild(h('span', { style: { color: 'var(--text-muted)', fontSize: '12px' } }, voteCount + ' (' + percent + '%)'));
          const barTrack = h('div', { style: { height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' } });
          const barFill = h('div', { style: { height: '100%', width: percent + '%', background: isMyVote ? 'var(--accent-aqua)' : 'var(--accent-amber)', borderRadius: '3px', transition: 'width 0.4s ease' } });
          barTrack.appendChild(barFill);
          optRow.appendChild(optLabel);
          optRow.appendChild(barTrack);
          optDiv.appendChild(optRow);
          card.appendChild(optDiv);
        });

        // Close button (for creator or owner)
        card.appendChild(h('button', {
          className: 'btn btn-ghost btn-xs',
          type: 'button',
          style: { marginTop: '10px' },
          onclick: () => closePoll(poll.id),
        }, 'Close Poll'));

        listDiv.appendChild(card);
      });
      section.appendChild(listDiv);
    }

    container.appendChild(section);
  }

  render();
  return container;
}
