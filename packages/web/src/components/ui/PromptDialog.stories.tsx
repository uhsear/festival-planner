import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import PromptDialog from './PromptDialog';
import Button from './Button';

const meta = {
  title: 'UI/PromptDialog',
  component: PromptDialog,
  tags: ['autodocs'],
  argTypes: {
    open: { control: 'boolean' },
    title: { control: 'text' },
    description: { control: 'text' },
    placeholder: { control: 'text' },
    defaultValue: { control: 'text' },
    confirmLabel: { control: 'text' },
    cancelLabel: { control: 'text' },
    inputType: {
      control: 'select',
      options: ['text', 'email', 'number'],
    },
    busy: { control: 'boolean' },
    maxLength: { control: 'number' },
    error: { control: 'text' },
  },
  // Render all args-based stories inside a portal-friendly container
  decorators: [
    (Story) => (
      <div style={{ minHeight: 400 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PromptDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// -- Default (open) --

export const Default: Story = {
  args: {
    open: true,
    onOpenChange: fn(),
    title: 'Rename Crew',
    placeholder: 'Enter new name',
    onConfirm: fn(),
  },
};

// -- With Description --

export const WithDescription: Story = {
  args: {
    open: true,
    onOpenChange: fn(),
    title: 'Join Festival',
    description: 'Enter the invite code shared by your crew leader.',
    placeholder: 'Invite code',
    confirmLabel: 'Join',
    onConfirm: fn(),
  },
};

// -- With Default Value --

export const WithDefaultValue: Story = {
  args: {
    open: true,
    onOpenChange: fn(),
    title: 'Edit Name',
    defaultValue: 'My Crew',
    confirmLabel: 'Save',
    onConfirm: fn(),
  },
};

// -- Busy State --

export const Busy: Story = {
  args: {
    open: true,
    onOpenChange: fn(),
    title: 'Creating...',
    placeholder: 'Crew name',
    defaultValue: 'Desert Vibes',
    confirmLabel: 'Create',
    busy: true,
    onConfirm: fn(),
  },
};

// -- With Error --

export const WithError: Story = {
  args: {
    open: true,
    onOpenChange: fn(),
    title: 'Join Festival',
    placeholder: 'Invite code',
    defaultValue: 'INVALID',
    confirmLabel: 'Join',
    error: 'Invalid invite code. Please check and try again.',
    onConfirm: fn(),
  },
};

// -- Email Input Type --

export const EmailInput: Story = {
  args: {
    open: true,
    onOpenChange: fn(),
    title: 'Invite by Email',
    description: 'Send an invite to a friend.',
    placeholder: 'friend@example.com',
    inputType: 'email',
    confirmLabel: 'Send Invite',
    onConfirm: fn(),
  },
};

// -- Custom Labels --

export const CustomLabels: Story = {
  args: {
    open: true,
    onOpenChange: fn(),
    title: 'Delete Crew',
    description: 'Type the crew name to confirm deletion.',
    placeholder: 'Crew name',
    confirmLabel: 'Delete',
    cancelLabel: 'Keep Crew',
    onConfirm: fn(),
  },
};

// -- Interactive Example --

export const Interactive: Story = {
  args: {
    open: false,
    onOpenChange: fn(),
    title: 'Interactive',
    onConfirm: fn(),
  },
  render: () => {
    const [open, setOpen] = useState(false);
    const [lastValue, setLastValue] = useState('');

    return (
      <div className="flex flex-col items-center gap-4">
        <Button variant="primary" onClick={() => setOpen(true)}>
          Open Prompt
        </Button>
        {lastValue && (
          <p className="text-sm text-text-secondary">
            Last submitted: <strong>{lastValue}</strong>
          </p>
        )}
        <PromptDialog
          open={open}
          onOpenChange={setOpen}
          title="What's your festival name?"
          description="This will be shown to your crew members."
          placeholder="e.g. Desert Vibes Crew"
          confirmLabel="Save"
          onConfirm={(value) => {
            setLastValue(value);
            setOpen(false);
          }}
        />
      </div>
    );
  },
};
