import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Copy, RefreshCw, Share2 } from 'lucide-react';
import { useCrewStore } from '@festie/shared/stores';
import { buildJoinUrl } from '@festie/shared/utils';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import { useToast } from '../../lib/toastContext';

interface CrewInviteBarProps {
  inviteCode: string;
  crewId: string;
  isOwner: boolean;
}

export default function CrewInviteBar({ inviteCode, crewId, isOwner }: CrewInviteBarProps) {
  const { toast } = useToast();
  const regenerateInvite = useCrewStore((s) => s.regenerateInvite);
  const [copiedCode, setCopiedCode] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    const url = buildJoinUrl(inviteCode, window.location.origin);
    navigator.clipboard?.writeText(url);
    setCopiedCode(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedCode(false), 2000);
  }, [inviteCode]);

  const handleShare = useCallback(async () => {
    const url = buildJoinUrl(inviteCode, window.location.origin);
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: 'Join my Festie crew', text: 'Join my crew on Festie', url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    handleCopy();
  }, [inviteCode, handleCopy]);

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleRegenerate = useCallback(async () => {
    if (regenBusy) return;
    setRegenBusy(true);
    try {
      await regenerateInvite(crewId);
      toast('Invite code regenerated', 'success');
      setConfirmRegen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't regenerate the invite code. Try again.", 'error');
    } finally {
      setRegenBusy(false);
    }
  }, [crewId, regenBusy, regenerateInvite, toast]);

  return (
    <div className="py-1.5 px-2 rounded-lg bg-bg-card border border-border flex items-center gap-2">
      <Copy className="w-3.5 h-3.5 text-text-muted flex-shrink-0" aria-hidden="true" />
      <span className="text-xs text-text-secondary truncate">
        Invite: <span className="text-text-primary font-mono">{inviteCode}</span>
      </span>
      <div className="flex items-center gap-2 ml-auto flex-shrink-0">
        {isOwner && (
          <Button
            variant="outline"
            onClick={() => setConfirmRegen(true)}
            isLoading={regenBusy}
            aria-label="Regenerate invite code"
            className="!py-1 !px-2.5 min-w-11 text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
        )}
        {canNativeShare && (
          <Button
            variant="outline"
            onClick={handleShare}
            aria-label="Share invite link"
            className="!py-1 !px-2.5 min-w-11 text-xs"
          >
            <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
        )}
        <Button
          variant={copiedCode ? 'primary' : 'outline'}
          onClick={handleCopy}
          className={`!py-1 !px-2.5 text-xs ${copiedCode ? 'animate-[crew-copy-pulse_260ms_var(--ease-out,ease-out)] motion-reduce:!animate-none' : ''}`}
        >
          {copiedCode ? '✓' : 'Copy'}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmRegen}
        onOpenChange={setConfirmRegen}
        title="Regenerate invite code?"
        description="The current code stops working. Anyone with the old link will need the new one."
        confirmLabel="Regenerate"
        destructive
        busy={regenBusy}
        onConfirm={handleRegenerate}
      />
    </div>
  );
}
