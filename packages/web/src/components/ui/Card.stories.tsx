import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card } from './Card';

const meta = {
  title: 'UI/Card',
  component: Card,
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'elevated', 'interactive', 'flush'],
    },
    padding: {
      control: 'select',
      options: ['none', 'sm', 'md', 'lg'],
    },
  },
  args: {
    variant: 'default',
    padding: 'md',
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

/* ---------------------------------------------------------------------------
 * Variant stories
 * -------------------------------------------------------------------------*/

export const Default: Story = {
  args: { variant: 'default' },
  render: (args) => (
    <Card {...args} style={{ width: 320 }}>
      <p className="text-text-primary text-sm">
        Default card with glass background, border, and rounded corners.
      </p>
    </Card>
  ),
};

export const Elevated: Story = {
  args: { variant: 'elevated' },
  render: (args) => (
    <Card {...args} style={{ width: 320 }}>
      <p className="text-text-primary text-sm">
        Elevated card with backdrop-filter glass and shadow-lg.
      </p>
    </Card>
  ),
};

export const Interactive: Story = {
  args: { variant: 'interactive' },
  render: (args) => (
    <Card {...args} style={{ width: 320 }}>
      <p className="text-text-primary text-sm">
        Interactive card -- hover to see translate-y and shadow, click for scale.
      </p>
    </Card>
  ),
};

export const Flush: Story = {
  args: { variant: 'flush', padding: 'none' },
  render: (args) => (
    <Card {...args} style={{ width: 320 }}>
      <div className="bg-accent-aqua/10 p-4 rounded-DEFAULT">
        <p className="text-text-primary text-sm">
          Flush card with no padding -- content bleeds to the edges.
        </p>
      </div>
    </Card>
  ),
};

/* ---------------------------------------------------------------------------
 * Padding stories
 * -------------------------------------------------------------------------*/

export const PaddingNone: Story = {
  args: { padding: 'none' },
  render: (args) => (
    <Card {...args} style={{ width: 320 }}>
      <p className="text-text-primary text-sm">padding: none</p>
    </Card>
  ),
};

export const PaddingSm: Story = {
  args: { padding: 'sm' },
  render: (args) => (
    <Card {...args} style={{ width: 320 }}>
      <p className="text-text-primary text-sm">padding: sm (p-3)</p>
    </Card>
  ),
};

export const PaddingMd: Story = {
  args: { padding: 'md' },
  render: (args) => (
    <Card {...args} style={{ width: 320 }}>
      <p className="text-text-primary text-sm">padding: md (p-4)</p>
    </Card>
  ),
};

export const PaddingLg: Story = {
  args: { padding: 'lg' },
  render: (args) => (
    <Card {...args} style={{ width: 320 }}>
      <p className="text-text-primary text-sm">padding: lg (p-6)</p>
    </Card>
  ),
};

/* ---------------------------------------------------------------------------
 * Compound components
 * -------------------------------------------------------------------------*/

export const WithHeaderAndFooter: Story = {
  render: () => (
    <Card style={{ width: 360 }}>
      <Card.Header>
        <div className="w-8 h-8 rounded-full bg-accent-aqua/20 flex items-center justify-center text-accent-aqua text-sm font-semibold">
          F
        </div>
        <div className="flex-1">
          <p className="text-text-primary text-sm font-medium">Festival Name</p>
          <p className="text-text-muted text-xs">3 days away</p>
        </div>
      </Card.Header>
      <Card.Body>
        <p className="text-text-secondary text-sm">
          Card body content sits between the header and footer with flex-1 so it
          fills available space.
        </p>
      </Card.Body>
      <Card.Footer>
        <button className="text-accent-aqua text-sm font-medium">View</button>
        <span className="flex-1" />
        <span className="text-text-muted text-xs">Updated 2m ago</span>
      </Card.Footer>
    </Card>
  ),
};

export const HeaderOnly: Story = {
  render: () => (
    <Card style={{ width: 360 }}>
      <Card.Header>
        <p className="text-text-primary text-sm font-medium">Section Title</p>
      </Card.Header>
      <Card.Body>
        <p className="text-text-secondary text-sm">
          A card with only a header and body, no footer.
        </p>
      </Card.Body>
    </Card>
  ),
};

export const InteractiveCompound: Story = {
  args: { variant: 'interactive' },
  render: (args) => (
    <Card {...args} style={{ width: 360 }}>
      <Card.Header>
        <p className="text-text-primary text-sm font-medium">Clickable Card</p>
      </Card.Header>
      <Card.Body>
        <p className="text-text-secondary text-sm">
          Interactive variant with compound sub-components. Hover and click to
          see the transitions.
        </p>
      </Card.Body>
      <Card.Footer>
        <span className="text-accent-aqua text-xs font-medium">
          Tap to expand
        </span>
      </Card.Footer>
    </Card>
  ),
};
