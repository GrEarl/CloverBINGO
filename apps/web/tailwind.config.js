/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // CloverPit-inspired palette
        pit: {
          bg: '#0a0a0a',     // Deepest black/gray background
          wall: '#171717',   // Concrete wall color
          surface: '#262626', // Slightly lighter surface
          border: '#404040',  // Industrial metal borders
          
          primary: '#eab308', // Amber/Gold (Coins, Wins) - keeping similar to 'amber' but specific
          secondary: '#10b981', // CRT Green / Clover Green
          danger: '#ef4444',  // Alarm Red
          
          text: {
            main: '#e5e5e5', // Off-white
            dim: '#a3a3a3',  // Dimmed text
            muted: '#525252', // Muted text
          }
        }
      },
      fontFamily: {
        // Fallback to standard sans/mono, but plan to swap if a better font is found
        mono: ['"VT323"', 'monospace'], // Retro terminal feel
        header: ['"PerfectDOSVGA437"', '"Share Tech Mono"', 'monospace'], // Display reel digits
        sans: ['"Inter"', 'sans-serif'],
      },
      backgroundImage: {
        'noise': "url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMTcxNzE3Ii8+PHBhdGggZD0iTTAgMGgxMDB2MTAwSDB6IiBmaWxsPSJ1cmwoI2EpIi8+PGRlZnM+PHBhdHRlcm4gaWQ9ImEiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgMGgxMHYxMEgwWiIgZmlsbD0ibm9uZSJsLz48Y2lyY2xlIGN4PSI1IiBjeT0iNSIgcj0iMSIgZmlsbD0iIzQwNDA0MCIgb3BhY2l0eT0iLjIiLz48L3BhdHRlcm4+PC9kZWZzPjwvc3ZnPg==')",
      }
    },
  },
  plugins: [],
}
