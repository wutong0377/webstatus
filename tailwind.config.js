/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/views/**/*.html',
    './src/views/**/*.js'
  ],
  // 安全列表：覆盖 JS 中由数据驱动、可能以字符串拼接方式出现的状态类
  //（这些类已出现在源码字面量中，扫描可捕获；此处为双保险，防止未来改代码时遗漏）
  safelist: [
    'bg-emerald-500', 'text-emerald-600', 'dark:text-emerald-400',
    'bg-amber-500', 'text-amber-600', 'dark:text-amber-400',
    'bg-red-500', 'text-red-600', 'dark:text-red-400',
    'bg-blue-500', 'text-blue-600', 'dark:text-blue-400',
    'bg-slate-400', 'text-slate-500', 'dark:text-slate-400',
    'bg-emerald-50', 'text-emerald-700', 'ring-emerald-600/20', 'dark:bg-emerald-500/10',
    'bg-amber-50', 'text-amber-700', 'ring-amber-600/20', 'dark:bg-amber-500/10',
    'bg-red-50', 'text-red-700', 'ring-red-600/20', 'dark:bg-red-500/10',
    'bg-blue-50', 'text-blue-700', 'ring-blue-600/20', 'dark:bg-blue-500/10',
    'bg-slate-100', 'text-slate-600', 'ring-slate-500/20', 'dark:bg-slate-700/40', 'dark:text-slate-300'
  ],
  theme: {
    extend: {}
  },
  plugins: []
};
