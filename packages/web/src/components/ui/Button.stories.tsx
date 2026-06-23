import type { Meta, StoryObj } from '@storybook/react-vite';
import { RefreshCw, Trash2, Download, Heart } from 'lucide-react';
import Button from './Button';

const meta = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'danger', 'ghost', 'secondary', 'outline', 'util', 'delete'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    isLoading: { control: 'boolean' },
    fullWidth: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

// -- Variants --

export const Primary: Story = {
  args: {
    children: 'Primary Button',
    variant: 'primary',
  },
};

export const Danger: Story = {
  args: {
    children: 'Delete',
    variant: 'danger',
  },
};

export const Ghost: Story = {
  args: {
    children: 'Ghost',
    variant: 'ghost',
  },
};

export const Secondary: Story = {
  args: {
    children: 'Secondary',
    variant: 'secondary',
  },
};

export const Outline: Story = {
  args: {
    children: 'Outline',
    variant: 'outline',
  },
};

export const Util: Story = {
  args: {
    children: 'Install App',
    variant: 'util',
    icon: <Download className="w-3 h-3" />,
  },
};

export const Delete: Story = {
  args: {
    variant: 'delete',
    'aria-label': 'Delete item',
    icon: <Trash2 className="w-4 h-4" />,
  },
};

// -- Sizes --

export const Small: Story = {
  args: {
    children: 'Small',
    size: 'sm',
  },
};

export const Medium: Story = {
  args: {
    children: 'Medium',
    size: 'md',
  },
};

export const Large: Story = {
  args: {
    children: 'Large',
    size: 'lg',
  },
};

// -- States --

export const Disabled: Story = {
  args: {
    children: 'Disabled',
    disabled: true,
  },
};

export const Loading: Story = {
  args: {
    children: 'Saving...',
    isLoading: true,
  },
};

export const LoadingDanger: Story = {
  args: {
    children: 'Deleting...',
    variant: 'danger',
    isLoading: true,
  },
};

export const FullWidth: Story = {
  args: {
    children: 'Full Width',
    fullWidth: true,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
};

// -- With Icon --

export const WithIcon: Story = {
  args: {
    children: 'Retry',
    variant: 'primary',
    size: 'sm',
    icon: <RefreshCw className="w-3.5 h-3.5" />,
  },
};

export const GhostWithIcon: Story = {
  args: {
    children: 'Support Me',
    variant: 'ghost',
    icon: <Heart className="w-3.5 h-3.5" />,
  },
};

// -- Combined --

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="util" icon={<Download className="w-3 h-3" />}>Install</Button>
      <Button variant="delete" aria-label="Delete" icon={<Trash2 className="w-4 h-4" />} />
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
};
