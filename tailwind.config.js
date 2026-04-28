/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 所有颜色用 CSS variable 取值，主题切换只改 :root 上的变量
        bg: {
          DEFAULT: 'rgb(var(--c-bg) / <alpha-value>)',
          elev: 'rgb(var(--c-bg-elev) / <alpha-value>)',
          elev2: 'rgb(var(--c-bg-elev2) / <alpha-value>)',
          card: 'rgb(var(--c-bg-card) / <alpha-value>)',
        },
        line: 'rgb(var(--c-line) / <alpha-value>)',
        'line-strong': 'rgb(var(--c-line-strong) / <alpha-value>)',
        ink: {
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          dim: 'rgb(var(--c-ink-dim) / <alpha-value>)',
          mute: 'rgb(var(--c-ink-mute) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          glow: 'rgb(var(--c-accent-glow) / <alpha-value>)',
          deep: 'rgb(var(--c-accent-deep) / <alpha-value>)',
        },
        cyan: {
          DEFAULT: 'rgb(var(--c-cyan) / <alpha-value>)',
        },
        ok: 'rgb(var(--c-ok) / <alpha-value>)',
        warn: 'rgb(var(--c-warn) / <alpha-value>)',
        bad: 'rgb(var(--c-bad) / <alpha-value>)',
      },
      fontFamily: {
        // 西文 Manrope（圆润现代）+ 中文系统圆体堆栈：
        //   PingFang SC (macOS/iOS) / HarmonyOS Sans SC (鸿蒙) / Microsoft YaHei UI (Win10+)
        sans: [
          'Manrope',
          'PingFang SC',
          'HarmonyOS Sans SC',
          'Source Han Sans CN',
          'Noto Sans SC',
          'Microsoft YaHei UI',
          'Microsoft YaHei',
          'system-ui',
          'sans-serif',
        ],
        // 等宽 Fira Code（圆润 + ligature）
        mono: [
          'Fira Code',
          'JetBrains Mono',
          'Cascadia Code',
          'Menlo',
          'Consolas',
          'monospace',
        ],
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
