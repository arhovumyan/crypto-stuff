# 10 Dollar Monster - Web UI

A beautiful, family-friendly web interface for managing the 10 Dollar Monster crypto auto-buyer service.

## 🎨 Features

- **Real-time Monitoring Dashboard** - See service status at a glance
- **Easy Wallet Management** - Add/remove wallet addresses with a simple textarea
- **Purchase History** - View all past purchases with success/failure status
- **Responsive Design** - Works on desktop, tablet, and mobile
- **Dark Mode Support** - Automatically adapts to system preferences
- **Live Updates** - Dashboard refreshes every 5 seconds

## 🚀 Quick Start (Local Development)

1. Install dependencies:
```bash
npm install
```

2. Create `.env.local` file:
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

3. Make sure the backend API is running:
```bash
cd ../services/10DollarMonster
npm run dev:api
```

4. Start the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## 🏗️ Build for Production

```bash
npm run build
npm start
```

## 📦 Deploy to Vercel

See the main [DEPLOYMENT.md](../DEPLOYMENT.md) guide for detailed instructions.

Quick deploy:
```bash
vercel
```

## 🎯 Usage

### Start Monitoring
1. Enter wallet addresses (one per line) in the text area
2. Click "Start Monitoring"
3. The service will check every 60 seconds for new swaps
4. When a swap is detected, it automatically buys $10 worth

### Stop Monitoring
- Click "Stop Monitoring" to pause the service

### View Purchase History
- All purchases appear in the history section
- Click "View TX" to see the transaction on Solscan
- Green checkmark = successful purchase
- Red X = failed attempt (with reason shown)

## 🎨 UI Components

- **Status Card**: Shows current monitoring status and configuration
- **Wallet Configuration**: Text area for managing watched addresses  
- **Config Grid**: Displays watched wallet count, purchase amount, check interval
- **Trading Mode Badge**: Shows LIVE or PAPER trading mode
- **Purchase History**: Scrollable list of all purchase attempts
- **Error Display**: Shows any errors from the API

## 🌈 Color Scheme

- **Primary**: Blue gradients
- **Success**: Green for active states
- **Error**: Red for failures
- **Warning**: Yellow for paper trading mode
- **Background**: Gradient from blue → purple → pink

## 📱 Responsive Breakpoints

- **Mobile**: < 768px (single column layout)
- **Tablet**: 768px - 1024px (2 column grid)
- **Desktop**: > 1024px (3 column grid)

## 🔧 Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Backend API URL | `http://localhost:3001` |

## 📁 Project Structure

```
web/
├── app/
│   ├── layout.tsx          # Root layout with fonts and metadata
│   ├── page.tsx            # Main dashboard page
│   └── globals.css         # Global styles and Tailwind
├── public/                 # Static assets
├── package.json           # Dependencies
├── next.config.js         # Next.js configuration
├── tailwind.config.js     # Tailwind CSS configuration
└── tsconfig.json          # TypeScript configuration
```

## 🛠️ Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **HTTP Client**: Axios
- **Deployment**: Vercel

## 🔄 API Endpoints Used

- `GET /api/status` - Get current service status
- `POST /api/start` - Start monitoring
- `POST /api/stop` - Stop monitoring
- `GET /api/purchases` - Get purchase history
- `PUT /api/config` - Update configuration

## 🎭 Icons Used

- **Play**: Start monitoring button
- **Square**: Stop monitoring button
- **Wallet**: Wallet-related displays
- **DollarSign**: Purchase amount
- **Clock**: Check interval
- **CheckCircle**: Successful purchases
- **XCircle**: Failed purchases
- **AlertCircle**: Error messages

## 💡 Tips

1. **Keep it running**: Deploy to Vercel for 24/7 access
2. **Mobile access**: Add to home screen for app-like experience
3. **Multiple users**: Share the URL with family members
4. **Check history**: Review purchases before enabling live trading
5. **Paper trading first**: Test with paper trading before going live

## 🔐 Security Notes

- API endpoints should be secured in production
- Never expose seed phrases in the frontend
- Use environment variables for sensitive data
- Enable HTTPS (Vercel does this automatically)

## 📝 License

Same as parent project
