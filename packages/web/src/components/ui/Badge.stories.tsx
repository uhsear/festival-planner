import type { Meta, StoryObj } from '@storybook/react-vite';
import Badge from './Badge';

const meta = {
  title: 'UI/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['must', 'want', 'maybe', 'online', 'offline', 'count', 'outline'],
    },
    children: { control: 'text' },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

// -- Variants --

export const Default: Story = {
  args: {
    children: 'Badge',
    variant: 'count',
  },
};

export const Must: Story = {
  args: {
    children: 'Must See',
    variant: 'must',
  },
};

export const Want: Story = {
  args: {
    children: 'Want to See',
    variant: 'want',
  },
};

export const Maybe: Story = {
  args: {
    children: 'Maybe',
    variant: 'maybe',
  },
};

export const Online: Story = {
  args: {
    children: 'Online',
    variant: 'online',
  },
};

export const Offline: Story = {
  args: {
    children: 'Offline',
    variant: 'offline',
  },
};

export const Count: Story = {
  args: {
    children: '12',
    variant: 'count',
  },
};

export const Outline: Story = {
  args: {
    children: 'Outline',
    variant: 'outline',
  },
};

// -- Combined --

export const AllVariants: Story = {
  args: {
    children: 'Badge',
  },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Badge variant="must">Must See</Badge>
      <Badge variant="want">Want to See</Badge>
      <Badge variant="maybe">Maybe</Badge>
      <Badge variant="online">Online</Badge>
      <Badge variant="offline">Offline</Badge>
      <Badge variant="count">5</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>
  ),
};
