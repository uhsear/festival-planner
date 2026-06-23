import type { Meta, StoryObj } from '@storybook/react-vite';
import { Music, Users, Calendar, Search } from 'lucide-react';
import { fn } from 'storybook/test';
import EmptyState from './EmptyState';

const meta = {
  title: 'UI/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text' },
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

// -- Default (title only) --

export const Default: Story = {
  args: {
    title: 'No items found',
  },
};

// -- With Description --

export const WithDescription: Story = {
  args: {
    title: 'No festivals yet',
    description: 'Create or join a festival to get started with your crew.',
  },
};

// -- With Icon --

export const WithIcon: Story = {
  args: {
    icon: <Music className="w-12 h-12" />,
    title: 'No picks yet',
    description: 'Browse the lineup and pick the sets you want to see.',
  },
};

// -- With CTA --

export const WithCTA: Story = {
  args: {
    icon: <Users className="w-12 h-12" />,
    title: 'No crew members',
    description: 'Invite friends to join your festival crew.',
    cta: {
      label: 'Invite Friends',
      onClick: fn(),
    },
  },
};

// -- Without CTA --

export const WithoutCTA: Story = {
  args: {
    icon: <Search className="w-12 h-12" />,
    title: 'No results',
    description: 'Try a different search term or filter.',
  },
};

// -- Variations --

export const CalendarEmpty: Story = {
  args: {
    icon: <Calendar className="w-12 h-12" />,
    title: 'No events today',
    description: 'Check back later or browse upcoming days.',
    cta: {
      label: 'Browse Schedule',
      onClick: fn(),
    },
  },
};

export const MinimalTitleOnly: Story = {
  args: {
    title: 'Nothing here',
  },
};
