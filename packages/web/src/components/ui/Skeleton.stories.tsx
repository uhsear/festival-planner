import type { Meta, StoryObj } from '@storybook/react-vite';
import Skeleton from './Skeleton';

const meta = {
  title: 'UI/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['text', 'circle', 'card', 'header'],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

// -- Variants --

export const Default: Story = {
  args: {
    variant: 'text',
  },
};

export const Text: Story = {
  args: {
    variant: 'text',
  },
};

export const Circle: Story = {
  args: {
    variant: 'circle',
  },
};

export const Card: Story = {
  args: {
    variant: 'card',
  },
};

export const Header: Story = {
  args: {
    variant: 'header',
  },
};

// -- Combined --

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-4" style={{ width: 360 }}>
      <Skeleton variant="header" />
      <Skeleton variant="text" />
      <Skeleton variant="text" />
      <Skeleton variant="text" className="w-2/3" />
      <div className="flex items-center gap-3">
        <Skeleton variant="circle" />
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" />
          <Skeleton variant="text" className="w-1/2" />
        </div>
      </div>
      <Skeleton variant="card" />
    </div>
  ),
};

export const ContentPlaceholder: Story = {
  render: () => (
    <div className="space-y-4" style={{ width: 360 }}>
      <div className="flex items-center gap-3">
        <Skeleton variant="circle" />
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" className="w-1/3" />
          <Skeleton variant="text" className="w-1/4" />
        </div>
      </div>
      <Skeleton variant="text" />
      <Skeleton variant="text" />
      <Skeleton variant="text" className="w-3/4" />
      <Skeleton variant="card" />
    </div>
  ),
};
