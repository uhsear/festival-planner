import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Copy, RefreshCw, Share2 } from 'lucide-react';
import { useCrewStore } from '@festie/shared/stores';
import Button from '../ui/Button';
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
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    const url = `${window.location.origin}/api/v1/crews/join/${inviteCode}`;
    navigator.clipboard?.writeText(url);
    setCopiedCode(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedCode(false), 2000);
  }, [inviteCode]);

  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}/api/v1/crews/join/${inviteCode}`;
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
    if (!window.confirm('Regenerate invite code? The current code will stop working.')) return;
    setRegenBusy(true);
    try {
      await regenerateInvite(crewId);
      toast('Invite code regenerated', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to regenerate invite', 'error');
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
            onClick={handleRegenerate}
            isLoading={regenBusy}
            aria-label="Regenerate invite code"
            className="!py-1 !px-2.5 text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
        )}
        {canNativeShare && (
          <Button
            variant="outline"
            onClick={handleShare}
            aria-label="Share invite link"
            className="!py-1 !px-2.5 text-xs"
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
    </div>
  );
}
