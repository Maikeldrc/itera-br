/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        display: ['Space Grotesk', 'sans-serif'],
      },
      colors: {
        'primary-blue': '#1b98e0',
        'dark-blue': '#004e89',
        'secondary-blue': '#1a659e',
        'accent-orange': '#ff4601',
        'light-bg': '#e8f1f2',
      },
    },
  },
  plugins: [],
};
