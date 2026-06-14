import { useNavigate } from '@tanstack/react-router';
import { Star, Users, Clock, type LucideIcon } from 'lucide-react';
import Button from '../ui/Button';
import { cn } from '@/lib/utils';

interface GuestTeaserProps {
  mode: 'picks' | 'crew' | 'grid';
  className?: string;
}

const CONFIG: Record<GuestTeaserProps['mode'], { Icon: LucideIcon; title: string; description: string; cta: string }> =
  {
    picks: {
      Icon: Star,
      title: 'Save your festival picks',
      description:
        'Sign in to mark artists as Must See, Want to See, or Maybe — sync across devices and share with your crew.',
      cta: 'Sign Up Free',
    },
    crew: {
      Icon: Users,
      title: 'Plan with your crew',
      description:
        'Create a crew, invite friends, compare picks, and find sets you all want to see. Sign up to get started.',
      cta: 'Sign Up Free',
    },
    grid: {
      Icon: Clock,
      title: 'See the whole schedule at a glance',
      description:
        'Grid view shows every stage and set across the festival. Sign in to track conflicts and plan your day.',
      cta: 'Sign Up Free',
    },
  };

export default function GuestTeaser({ mode, className }: GuestTeaserProps) {
  const navigate = useNavigate();
  const config = CONFIG[mode];
  const Icon = config.Icon;

  return (
    <section
      aria-labelledby={`guest-teaser-${mode}-heading`}
      className={cn('flex flex-col items-center justify-center py-8 px-4', className)}
    >
      <Icon aria-hidden="true" className="w-14 h-14 text-accent-aqua mb-6" />
      <h2
        id={`guest-teaser-${mode}-heading`}
        className="text-2xl font-display font-bold text-text-primary mb-3 text-center"
      >
        {config.title}
      </h2>
      <p className="text-center text-text-secondary mb-8 max-w-sm text-sm leading-relaxed">{config.description}</p>
      <Button variant="primary" onClick={() => navigate({ to: '/register' })}>
        {config.cta}
      </Button>
    </section>
  );
}
