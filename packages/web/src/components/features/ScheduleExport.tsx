import React, { useState } from 'react';
import Button from '../ui/Button';
import { Download, Share2, Calendar, Link2, Image } from 'lucide-react';

interface ScheduleExportProps {
  festivalId: string;
  profileId?: string;
}

export default function ScheduleExport({ festivalId, profileId }: ScheduleExportProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const handleExportPDF = async () => {
    if (!profileId) return;
    setLoading('pdf');
    try {
      const response = await fetch(`/api/v1/export/${festivalId}/${profileId}`, {
        credentials: 'same-origin',
      });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'festival-picks.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export PDF', error);
    } finally {
      setLoading(null);
    }
  };

  const handleExportCalendar = async () => {
    if (!profileId) return;
    setLoading('ics');
    try {
      const response = await fetch(`/api/v1/export/${festivalId}/${profileId}/calendar`, {
        credentials: 'same-origin',
      });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'festival-picks.ics';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export calendar', error);
    } finally {
      setLoading(null);
    }
  };

  const handleShareImage = async () => {
    setLoading('image');
    try {
      const response = await fetch(`/api/v1/export-card/${festivalId}`, {
        credentials: 'same-origin',
      });
      const blob = await response.blob();
      const file = new File([blob], 'my-picks.png', { type: 'image/png' });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My Festival Picks' });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'my-picks.png';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Failed to share image', error);
    } finally {
      setLoading(null);
    }
  };

  const handleSubscribeCalendar = async () => {
    setLoading('calendar');
    try {
      const response = await fetch(`/api/v1/calendar-sync/${festivalId}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (data.data?.url) {
        await navigator.clipboard?.writeText(data.data.url);
        setCopyFeedback('Calendar sync URL copied!');
        setTimeout(() => setCopyFeedback(null), 3000);
      }
    } catch (error) {
      console.error('Failed to generate calendar sync', error);
    } finally {
      setLoading(null);
    }
  };

  const handleShareLink = async () => {
    if (!profileId) return;
    try {
      const shareUrl = `${window.location.origin}/s/${profileId}`;
      await navigator.clipboard?.writeText(shareUrl);
      setCopyFeedback('Share link copied!');
      setTimeout(() => setCopyFeedback(null), 3000);
    } catch (error) {
      console.error('Failed to copy link', error);
    }
  };

  return (
    <div className="space-y-4 p-4 rounded-xl bg-bg-card border border-border">
      <div>
        <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
          <Share2 className="w-4 h-4 text-accent-aqua" />
          Export Schedule
        </h3>
        <p className="text-sm text-text-secondary mb-4">
          Export your picks for printing or sync with your phone calendar
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={handleExportPDF}
          disabled={!profileId || loading === 'pdf'}
          className="flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          {loading === 'pdf' ? 'Exporting...' : 'Export PDF'}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCalendar}
          disabled={!profileId || loading === 'ics'}
          className="flex items-center gap-2"
        >
          <Calendar className="w-4 h-4" />
          {loading === 'ics' ? 'Exporting...' : 'Add to Calendar'}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleShareImage}
          disabled={loading === 'image'}
          className="flex items-center gap-2"
        >
          <Image className="w-4 h-4" />
          {loading === 'image' ? 'Generating...' : 'Share as Image'}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleSubscribeCalendar}
          disabled={loading === 'calendar'}
          className="flex items-center gap-2"
        >
          <Calendar className="w-4 h-4" />
          {loading === 'calendar' ? 'Generating...' : 'Subscribe'}
        </Button>

        {profileId && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleShareLink}
            className="flex items-center gap-2"
          >
            <Link2 className="w-4 h-4" />
            Share My Picks
          </Button>
        )}
      </div>

      {copyFeedback && (
        <div className="text-sm text-accent-aqua font-semibold animate-fade-in">
          ✓ {copyFeedback}
        </div>
      )}
    </div>
  );
}
