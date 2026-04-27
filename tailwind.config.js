/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0a0b14',
          elev: '#11131e',
          elev2: '#161a28',
          card: '#1a1f30',
        },
        line: '#262b3d',
        ink: {
          DEFAULT: '#e7eaf3',
          dim: '#9aa3b8',
          mute: '#5f6884',
        },
        accent: {
          DEFAULT: '#7c83ff',
          glow: '#9aa0ff',
          deep: '#5158d8',
        },
        cyan: {
          DEFAULT: '#22d3ee',
        },
        ok: '#34d399',
        warn: '#fbbf24',
        bad: '#f87171',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 24px -4px rgb(124 131 255 / 0.5)',
        soft: '0 6px 22px -8px rgb(0 0 0 / 0.45)',
      },
      backdropBlur: {
        xs: '2px',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(124 131 255 / 0.6)' },
          '50%': { boxShadow: '0 0 0 12px rgb(124 131 255 / 0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2s linear infinite',
        pulseGlow: 'pulseGlow 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
