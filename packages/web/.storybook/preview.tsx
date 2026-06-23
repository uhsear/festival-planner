import type { Preview } from '@storybook/react-vite';

// Import the full global stylesheet (theme tokens, Tailwind utilities, base styles, etc.)
import '../src/styles/globals.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: { disable: true },
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="bg-bg-primary text-text-primary min-h-screen p-8 font-body">
        <Story />
      </div>
    ),
  ],
};

export default preview;
