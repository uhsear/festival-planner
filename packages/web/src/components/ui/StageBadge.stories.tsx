import type { Meta, StoryObj } from '@storybook/react-vite';
import StageBadge from './StageBadge';

const meta = {
  title: 'UI/StageBadge',
  component: StageBadge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'chip', 'pick'],
    },
    stageName: { control: 'text' },
    stageColor: { control: 'color' },
    active: { control: 'boolean' },
  },
} satisfies Meta<typeof StageBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

// -- Default --

export const Default: Story = {
  args: {
    stageName: 'Main Stage',
    stageColor: '#e74c3c',
  },
};

// -- Variants --

export const DefaultVariant: Story = {
  args: {
    stageName: 'Main Stage',
    stageColor: '#e74c3c',
    variant: 'default',
  },
};

export const ChipActive: Story = {
  args: {
    stageName: 'Sahara',
    stageColor: '#f39c12',
    variant: 'chip',
    active: true,
  },
};

export const ChipInactive: Story = {
  args: {
    stageName: 'Sahara',
    stageColor: '#f39c12',
    variant: 'chip',
    active: false,
  },
};

export const Pick: Story = {
  args: {
    stageName: 'Outdoor',
    stageColor: '#2ecc71',
    variant: 'pick',
  },
};

// -- Different Stage Colors --

export const StageColors: Story = {
  args: {
    stageName: 'Stage',
    stageColor: '#e74c3c',
  },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <StageBadge stageName="Main Stage" stageColor="#e74c3c" />
      <StageBadge stageName="Sahara" stageColor="#f39c12" />
      <StageBadge stageName="Outdoor" stageColor="#2ecc71" />
      <StageBadge stageName="Gobi" stageColor="#3498db" />
      <StageBadge stageName="Mojave" stageColor="#9b59b6" />
      <StageBadge stageName="Sonora" stageColor="#1abc9c" />
    </div>
  ),
};

// -- Chip Variants (Active vs Inactive) --

export const ChipStates: Story = {
  args: {
    stageName: 'Stage',
    stageColor: '#e74c3c',
  },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <StageBadge stageName="Main Stage" stageColor="#e74c3c" variant="chip" active />
      <StageBadge stageName="Main Stage" stageColor="#e74c3c" variant="chip" active={false} />
      <StageBadge stageName="Sahara" stageColor="#f39c12" variant="chip" active />
      <StageBadge stageName="Sahara" stageColor="#f39c12" variant="chip" active={false} />
      <StageBadge stageName="Outdoor" stageColor="#2ecc71" variant="chip" active />
      <StageBadge stageName="Outdoor" stageColor="#2ecc71" variant="chip" active={false} />
    </div>
  ),
};

// -- Pick Variant --

export const PickVariants: Story = {
  args: {
    stageName: 'Stage',
    stageColor: '#e74c3c',
  },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <StageBadge stageName="Main Stage" stageColor="#e74c3c" variant="pick" />
      <StageBadge stageName="Sahara" stageColor="#f39c12" variant="pick" />
      <StageBadge stageName="Outdoor" stageColor="#2ecc71" variant="pick" />
      <StageBadge stageName="Gobi" stageColor="#3498db" variant="pick" />
    </div>
  ),
};

// -- Light Colors (tests WCAG contrast adjustment) --

export const LightColors: Story = {
  args: {
    stageName: 'Stage',
    stageColor: '#ffff00',
  },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <StageBadge stageName="Yellow Stage" stageColor="#ffff00" />
      <StageBadge stageName="Lime Stage" stageColor="#c0ff00" />
      <StageBadge stageName="Cyan Stage" stageColor="#00ffff" />
      <StageBadge stageName="Pink Stage" stageColor="#ffb6c1" />
    </div>
  ),
};
