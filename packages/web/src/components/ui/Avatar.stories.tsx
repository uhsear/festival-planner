import type { Meta, StoryObj } from '@storybook/react-vite';
import Avatar from './Avatar';

const meta = {
  title: 'UI/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg'],
    },
    name: { control: 'text' },
    image: { control: 'text' },
    showOnline: { control: 'boolean' },
    isOnline: { control: 'boolean' },
  },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

// -- Default (initials) --

export const Default: Story = {
  args: {
    name: 'Jane Doe',
    size: 'md',
  },
};

// -- With Image --

export const WithImage: Story = {
  args: {
    name: 'Jane Doe',
    image: 'https://i.pravatar.cc/150?u=jane',
    size: 'md',
  },
};

// -- Sizes --

export const ExtraSmall: Story = {
  args: {
    name: 'Alice B',
    size: 'xs',
  },
};

export const Small: Story = {
  args: {
    name: 'Alice B',
    size: 'sm',
  },
};

export const Medium: Story = {
  args: {
    name: 'Alice B',
    size: 'md',
  },
};

export const Large: Story = {
  args: {
    name: 'Alice B',
    size: 'lg',
  },
};

// -- Online Status --

export const OnlineIndicator: Story = {
  args: {
    name: 'Bob Smith',
    size: 'md',
    showOnline: true,
    isOnline: true,
  },
};

export const OfflineIndicator: Story = {
  args: {
    name: 'Bob Smith',
    size: 'md',
    showOnline: true,
    isOnline: false,
  },
};

// -- Combined --

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-end gap-3">
      <Avatar name="User" size="xs" />
      <Avatar name="User" size="sm" />
      <Avatar name="User" size="md" />
      <Avatar name="User" size="lg" />
    </div>
  ),
};

export const WithOnlineStatus: Story = {
  render: () => (
    <div className="flex items-end gap-4">
      <Avatar name="Online User" size="sm" showOnline isOnline />
      <Avatar name="Offline User" size="sm" showOnline isOnline={false} />
      <Avatar name="Online User" size="md" showOnline isOnline />
      <Avatar name="Offline User" size="md" showOnline isOnline={false} />
      <Avatar name="Online User" size="lg" showOnline isOnline />
      <Avatar name="Offline User" size="lg" showOnline isOnline={false} />
    </div>
  ),
};

export const DifferentNames: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Avatar name="Alice Walker" size="md" />
      <Avatar name="Bob Dylan" size="md" />
      <Avatar name="Charlie Brown" size="md" />
      <Avatar name="Diana Ross" size="md" />
      <Avatar name="Elvis Presley" size="md" />
    </div>
  ),
};
