/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 盘账助手 色彩语义 (保留)
        life: '#1a73e8',       // 生活-蓝 (Google Blue)
        consume: '#7c3aed',    // 消费-紫
        expense: '#0d9488',    // 支出-绿 (teal)
        income: '#ea4335',     // 收入-红 (Google Red)
        // Google Material 基础色
        gblue: '#1a73e8',
        gbg: '#f8f9fa',
        gcard: '#ffffff',
        gtext: '#202124',
        gsub: '#5f6368',
        gborder: '#dadce0',
      },
      maxWidth: {
        app: '480px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(60,64,67,0.15), 0 1px 2px rgba(60,64,67,0.1)',
        cardHover: '0 4px 8px rgba(60,64,67,0.15), 0 2px 4px rgba(60,64,67,0.1)',
        nav: '0 -1px 3px rgba(60,64,67,0.1)',
      },
    },
  },
  plugins: [],
};
