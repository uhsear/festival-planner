import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Copy } from 'lucide-react';
import Button from '../ui/Button';

interface CrewInviteBarProps {
  inviteCode: string;
}

export default function CrewInviteBar({ inviteCode }: CrewInviteBarProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); };
  }, []);

  const handleCopy = useCallback(() => {
    const url = `${window.location.origin}/api/v1/crews/join/${inviteCode}`;
    navigator.clipboard?.writeText(url);
    setCopiedCode(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedCode(false), 2000);
  }, [inviteCode]);

  return (
    <div className="py-1.5 px-2 rounded-lg bg-bg-card border border-border flex items-center gap-2">
      <Copy className="w-3.5 h-3.5 text-text-muted flex-shrink-0" aria-hidden="true" />
      <span className="text-xs text-text-secondary truncate">
        Invite: <span className="text-text-primary font-mono">{inviteCode}</span>
      </span>
      <Button
        variant={copiedCode ? 'primary' : 'outline'}
        onClick={handleCopy}
        className={`!py-1 !px-2.5 text-xs ml-auto flex-shrink-0 ${copiedCode ? 'crew-copy-success' : ''}`}
      >
        {copiedCode ? '✓' : 'Copy'}
      </Button>
    </div>
  );
}
