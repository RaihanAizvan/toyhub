/** @type {import('tailwindcss').Config} */
export default {
    content: [
      "./views./**/*.{js,jsx,ts,tsx,ejs}",
    ],
    theme: {
      extend: {
        colors: {
          // Custom colors
          secondary: '#14171A',
        },
        spacing: {
          // Custom spacing
          '72': '18rem',
          '84': '21rem',
          '96': '24rem',
        },
        backgroundColor:{
          // Custom background colors
          secondary: '#3BB77E',
        },
        fontFamily: {
          // Custom fonts
          sans: ['Graphik', 'sans-serif'],
          serif: ['Merriweather', 'serif'],
        },
      },
    },
    plugins: [],
  }