# Brainrot UNO

Online and offline UNO with a cozy tabletop UI, Socket.io multiplayer, and shared game rules.

Created by **Aarab Malik**.

## Project layout

```
brainrot-uno/
├── frontend/          React + Vite client
│   ├── public/sprites/  Card art and table background
│   └── src/
│       ├── components/  Reusable UI (cards, overlays)
│       ├── game/        Table, bots, online match
│       ├── hooks/       Socket + card flight
│       ├── screens/     Menus and lobby
│       ├── styles/      Global and menu CSS
│       └── utils/       Client helpers
├── backend/           Socket.io rooms and game server
│   └── vite/          Dev-time Vite plugins (health, ngrok)
├── shared/            Game rules used by client and server
│   └── gameLogic.js
└── scripts/           Dev server, preview, port helpers
```

## Requirements

- Node.js 20.19+
- npm

## Setup

```bash
npm install
```

Optional — play over the internet with [ngrok](https://ngrok.com/):

1. Copy `.env.example` to `.env`
2. Add your `NGROK_AUTHTOKEN`

## Run locally

```bash
npm run dev
```

Open `http://localhost:5173`. One process serves the UI and multiplayer on port **5173**.

- `npm run dev:local` — skip ngrok (LAN only)
- `npm run build` — production build to `frontend/dist/`
- `npm run preview` — serve build + multiplayer

## How it works

- **Frontend** (`frontend/`): React app, menus, game table, animations.
- **Backend** (`backend/`): Room hosting, joins, sync, and authoritative moves over Socket.io.
- **Shared** (`shared/gameLogic.js`): Deck, turns, UNO rules — imported by both sides so logic stays in sync.

## Assets

Card sprites live in `frontend/public/sprites/` and are served at `/sprites/...`.
