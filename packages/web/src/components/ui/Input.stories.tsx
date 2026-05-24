import type { Meta, StoryObj } from '@storybook/react-vite';
import Input from './Input';

const meta = {
  title: 'UI/Input',
  component: Input,
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text' },
    error: { control: 'text' },
    helperText: { control: 'text' },
    placeholder: { control: 'text' },
    isPassword: { control: 'boolean' },
    variant: {
      control: 'select',
      options: ['default', 'search'],
    },
    disabled: { control: 'boolean' },
    type: {
      control: 'select',
      options: ['text', 'email', 'password', 'number', 'tel', 'url'],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

// -- Default --

export const Default: Story = {
  args: {
    placeholder: 'Enter text...',
  },
};

// -- With Label --

export const WithLabel: Story = {
  args: {
    label: 'Email',
    placeholder: 'you@example.com',
    type: 'email',
  },
};

// -- With Helper Text --

export const WithHelperText: Story = {
  args: {
    label: 'Username',
    placeholder: 'Pick a username',
    helperText: 'Must be 3-20 characters long',
  },
};

// -- Error State --

export const ErrorState: Story = {
  args: {
    label: 'Email',
    placeholder: 'you@example.com',
    error: 'Please enter a valid email address',
    defaultValue: 'not-an-email',
  },
};

// -- Disabled --

export const Disabled: Story = {
  args: {
    label: 'Name',
    placeholder: 'Cannot edit',
    disabled: true,
    defaultValue: 'Locked value',
  },
};

// -- Password --

export const Password: Story = {
  args: {
    label: 'Password',
    placeholder: 'Enter password',
    isPassword: true,
  },
};

// -- Password with Error --

export const PasswordWithError: Story = {
  args: {
    label: 'Password',
    placeholder: 'Enter password',
    isPassword: true,
    error: 'Password must be at least 8 characters',
  },
};

// -- Types --

export const EmailType: Story = {
  args: {
    label: 'Email',
    placeholder: 'you@example.com',
    type: 'email',
  },
};

export const NumberType: Story = {
  args: {
    label: 'Age',
    placeholder: '25',
    type: 'number',
  },
};

// -- Search Variant --

export const Search: Story = {
  args: {
    variant: 'search',
    placeholder: 'Search artists...',
    'aria-label': 'Search artists',
  },
};

// -- Search with Label --

export const SearchWithLabel: Story = {
  args: {
    variant: 'search',
    label: 'Find an artist',
    placeholder: 'Type a name...',
  },
};

// -- All States --

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-6" style={{ width: 320 }}>
      <Input placeholder="Default" />
      <Input label="With Label" placeholder="Labeled input" />
      <Input label="With Helper" placeholder="Helper text" helperText="Some helpful info" />
      <Input label="Error" placeholder="Error state" error="Something went wrong" />
      <Input label="Disabled" placeholder="Disabled" disabled defaultValue="Cannot edit" />
      <Input label="Password" placeholder="Password" isPassword />
      <Input variant="search" placeholder="Search..." aria-label="Search" />
    </div>
  ),
};
