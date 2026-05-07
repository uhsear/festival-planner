import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Input from './Input';

describe('Input', () => {
  describe('basic rendering', () => {
    it('renders a text input by default', () => {
      render(<Input aria-label="test" />);
      const input = screen.getByRole('textbox');
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('type', 'text');
    });

    it('renders with a label', () => {
      render(<Input label="Email" />);
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });

    it('associates label with input via htmlFor', () => {
      render(<Input label="Name" />);
      const input = screen.getByLabelText('Name');
      expect(input.tagName).toBe('INPUT');
    });

    it('uses provided id for label association', () => {
      render(<Input label="Name" id="my-input" />);
      const input = screen.getByLabelText('Name');
      expect(input).toHaveAttribute('id', 'my-input');
    });

    it('generates an id when none is provided', () => {
      render(<Input label="Field" />);
      const input = screen.getByLabelText('Field');
      expect(input.id).toBeTruthy();
    });
  });

  describe('error state', () => {
    it('displays error message', () => {
      render(<Input label="Email" error="Invalid email" />);
      expect(screen.getByText('Invalid email')).toBeInTheDocument();
    });

    it('sets aria-invalid when error is present', () => {
      render(<Input label="Email" error="Required" />);
      const input = screen.getByLabelText('Email');
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('sets aria-invalid to false when no error', () => {
      render(<Input label="Email" />);
      const input = screen.getByLabelText('Email');
      expect(input).toHaveAttribute('aria-invalid', 'false');
    });

    it('renders error with role=alert', () => {
      render(<Input label="Email" error="Bad input" />);
      expect(screen.getByRole('alert')).toHaveTextContent('Bad input');
    });

    it('links error to input via aria-describedby', () => {
      render(<Input label="Email" id="em" error="Required" />);
      const input = screen.getByLabelText('Email');
      expect(input).toHaveAttribute('aria-describedby', expect.stringContaining('em-error'));
    });
  });

  describe('helper text', () => {
    it('displays helper text when no error', () => {
      render(<Input label="Email" helperText="We will never share your email" />);
      expect(screen.getByText('We will never share your email')).toBeInTheDocument();
    });

    it('hides helper text when error is present', () => {
      render(
        <Input label="Email" helperText="Helper" error="Error" />,
      );
      expect(screen.queryByText('Helper')).not.toBeInTheDocument();
      expect(screen.getByText('Error')).toBeInTheDocument();
    });
  });

  describe('password mode', () => {
    it('renders password input when isPassword is true', () => {
      render(<Input label="Password" isPassword />);
      const input = screen.getByLabelText('Password');
      expect(input).toHaveAttribute('type', 'password');
    });

    it('toggles password visibility', async () => {
      const user = userEvent.setup();
      render(<Input label="Password" isPassword />);

      const input = screen.getByLabelText('Password');
      expect(input).toHaveAttribute('type', 'password');

      const toggle = screen.getByRole('button', { name: 'Show password' });
      await user.click(toggle);
      expect(input).toHaveAttribute('type', 'text');

      const hideToggle = screen.getByRole('button', { name: 'Hide password' });
      await user.click(hideToggle);
      expect(input).toHaveAttribute('type', 'password');
    });

    it('sets aria-pressed on the toggle button', async () => {
      const user = userEvent.setup();
      render(<Input label="Password" isPassword />);

      const toggle = screen.getByRole('button', { name: 'Show password' });
      expect(toggle).toHaveAttribute('aria-pressed', 'false');

      await user.click(toggle);
      expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('does not show toggle when isPassword is false', () => {
      render(<Input label="Name" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('user interaction', () => {
    it('calls onChange when user types', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      render(<Input label="Name" onChange={handleChange} />);

      await user.type(screen.getByLabelText('Name'), 'hello');
      expect(handleChange).toHaveBeenCalledTimes(5);
    });

    it('passes through additional HTML attributes', () => {
      render(<Input label="Email" placeholder="you@example.com" maxLength={50} />);
      const input = screen.getByLabelText('Email');
      expect(input).toHaveAttribute('placeholder', 'you@example.com');
      expect(input).toHaveAttribute('maxLength', '50');
    });

    it('can be disabled', () => {
      render(<Input label="Name" disabled />);
      expect(screen.getByLabelText('Name')).toBeDisabled();
    });
  });

  describe('custom type', () => {
    it('renders email type', () => {
      render(<Input label="Email" type="email" />);
      expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    });

    it('renders number type', () => {
      render(<Input label="Age" type="number" />);
      expect(screen.getByLabelText('Age')).toHaveAttribute('type', 'number');
    });
  });

  it('applies error styling class when error is present', () => {
    render(<Input label="Email" error="Bad" />);
    const input = screen.getByLabelText('Email');
    expect(input.className).toContain('border-accent-coral');
  });

  it('applies custom className', () => {
    render(<Input label="Name" className="extra-class" />);
    const input = screen.getByLabelText('Name');
    expect(input.className).toContain('extra-class');
  });
});
