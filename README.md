# Bullet Review

Daily Bullet Chess Analysis Tool - Analyze your chess games, track your performance, and identify patterns in your play.

## Features

- **Game Analysis**: Import PGN files from Lichess and analyze your bullet games
- **Performance Tracking**: View your rating, win rate, and performance rating
- **Time Pressure Analysis**: See how you perform when low on time
- **Opening Statistics**: Track your opening repertoire and success rates
- **Local Storage**: Save your daily reviews locally (browser storage)
- **Lichess Integration**: Fetch game evaluations from Lichess API

## Getting Started

### Prerequisites

- Node.js 14+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm start
```

The app will open at `http://localhost:3000`.

### Deployment

Deploy to GitHub Pages:

```bash
# Build and deploy
npm run deploy
```

Your site will be available at: `https://Krystof-gif.github.io/Bullet-analysis`

## How to Use

1. **Export your games**: Go to Lichess.org → Profile → "Export games"
   - Enable "Include headers", "Include evaluations", and "Include clocks" for best results
2. **Paste or upload**: Paste the PGN text or upload the .pgn file
3. **Analyze**: Click "Analyze the day" to see your stats
4. **Review**: Explore your performance metrics and identify improvements

## Technologies

- React 18
- Recharts for visualizations
- Lucide React for icons
- localStorage for data persistence

## License

MIT
