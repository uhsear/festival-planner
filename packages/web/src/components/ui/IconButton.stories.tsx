import type { Meta, StoryObj } from '@storybook/react-vite';
import { X, Trash2, Settings, Heart, Share2, MoreVertical } from 'lucide-react';
import IconButton from './IconButton';

const meta = {
  title: 'UI/IconButton',
  component: IconButton,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'ghost', 'danger'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md'],
    },
    disabled: { control: 'boolean' },
    label: { control: 'text' },
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

// -- Default --

export const Default: Story = {
  args: {
    icon: <X className="w-5 h-5" />,
    label: 'Close',
  },
};

// -- Variants --

export const DefaultVariant: Story = {
  args: {
    icon: <Settings className="w-5 h-5" />,
    label: 'Settings',
    variant: 'default',
  },
};

export const Ghost: Story = {
  args: {
    icon: <MoreVertical className="w-5 h-5" />,
    label: 'More options',
    variant: 'ghost',
  },
};

export const Danger: Story = {
  args: {
    icon: <Trash2 className="w-5 h-5" />,
    label: 'Delete',
    variant: 'danger',
  },
};

// -- Sizes --

export const SmallSize: Story = {
  args: {
    icon: <X className="w-4 h-4" />,
    label: 'Close',
    size: 'sm',
  },
};

export const MediumSize: Story = {
  args: {
    icon: <X className="w-5 h-5" />,
    label: 'Close',
    size: 'md',
  },
};

// -- States --

export const Disabled: Story = {
  args: {
    icon: <Heart className="w-5 h-5" />,
    label: 'Like',
    disabled: true,
  },
};

// -- Combined --

export const AllVariants: Story = {
  args: {
    icon: <X className="w-5 h-5" />,
    label: 'All variants',
  },
  render: () => (
    <div className="flex items-center gap-3">
      <IconButton icon={<Settings className="w-5 h-5" />} label="Settings" variant="default" />
      <IconButton icon={<MoreVertical className="w-5 h-5" />} label="More" variant="ghost" />
      <IconButton icon={<Trash2 className="w-5 h-5" />} label="Delete" variant="danger" />
    </div>
  ),
};

export const AllStates: Story = {
  args: {
    icon: <X className="w-5 h-5" />,
    label: 'All states',
  },
  render: () => (
    <div className="flex items-center gap-3">
      <IconButton icon={<Heart className="w-5 h-5" />} label="Normal" />
      <IconButton icon={<Heart className="w-5 h-5" />} label="Disabled" disabled />
      <IconButton icon={<Trash2 className="w-5 h-5" />} label="Danger" variant="danger" />
      <IconButton icon={<Trash2 className="w-5 h-5" />} label="Danger disabled" variant="danger" disabled />
    </div>
  ),
};

export const CommonIcons: Story = {
  args: {
    icon: <X className="w-5 h-5" />,
    label: 'Common icons',
  },
  render: () => (
    <div className="flex items-center gap-3">
      <IconButton icon={<X className="w-5 h-5" />} label="Close" />
      <IconButton icon={<Trash2 className="w-5 h-5" />} label="Delete" variant="danger" />
      <IconButton icon={<Settings className="w-5 h-5" />} label="Settings" />
      <IconButton icon={<Heart className="w-5 h-5" />} label="Like" />
      <IconButton icon={<Share2 className="w-5 h-5" />} label="Share" />
      <IconButton icon={<MoreVertical className="w-5 h-5" />} label="More" />
    </div>
  ),
};
