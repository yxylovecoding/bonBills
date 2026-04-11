/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 盘账助手 色彩规范
        life: '#3b82f6',       // 生活-蓝
        consume: '#8b5cf6',    // 消费-紫
        expense: '#10b981',    // 支出-绿
        income: '#ef4444',     // 收入-红
        bgDark: '#0a0a16',
        cardDark: '#111128',
      },
      maxWidth: {
        app: '480px',
      },
    },
  },
  plugins: [],
};
