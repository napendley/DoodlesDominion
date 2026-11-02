# Tabletop Online

The multiplayer version of your board game table. Up to 8 players join a room with a code, everyone sees every move live, and each player's hand stays private.

## What's in this folder

| File | What it does |
|---|---|
| `server.js` | The game server. It runs rooms, keeps the table in sync, and only sends each player their own hand. |
| `cards.js` | All card text: Lands (with their color groups), Quest, Treasure Chest, and Fate. Edit this to change the cards. |
| `public/` | The game page players open: `index.html`, `client.js`, `style.css`. |
| `public/assets/` | Your art: the board, card backs, Tavern, Keep, and the five Sovereign coins. Replace a file with one of the same name to update the art. |
| `package.json`, `render.yaml` | Settings the host uses to install and start the game. |

## Put it online (GitHub + Render, about 20 minutes)

You only do this once. After that, any change you upload to GitHub goes live by itself.

### 1. Put the code on GitHub
1. Make a free account at https://github.com if you don't have one.
2. Click **+** (top right) → **New repository**. Name it `tabletop-online`. It can be Private. Click **Create repository**.
3. On the new repository's page, click **uploading an existing file**.
4. Unzip `tabletop-online.zip` on your computer, open the folder, select **everything inside it** (including the `public` folder), and drag it onto the GitHub page.
   - Upload what's *inside* the folder, so `server.js` sits at the top level of the repository, not inside another folder.
   - If you can't see `.gitignore` (hidden files), that's fine to skip.
5. Click **Commit changes**.

### 2. Run it on Render
1. Make a free account at https://render.com and choose **Sign in with GitHub**.
2. Click **New** → **Blueprint**, pick your `tabletop-online` repository, and click **Apply**. Render reads `render.yaml` and sets everything up.
   - If you'd rather click through it: **New** → **Web Service** → pick the repository, set **Build command** to `npm install`, **Start command** to `npm start`, and **Instance type** to Free.
3. Wait a few minutes for the first build. When it says **Live**, your game's address is at the top of the page, something like `https://tabletop-online-abcd.onrender.com`.

### 3. Play
1. Open your address, type your name, and leave the room code blank to start a new room.
2. Click **Invite** (it copies a link) and send it to your friends. They type a name and they're in.

## Good to know
- **Free hosting naps.** Render's free plan sleeps after about 15 minutes with no players, so the first person to open it waits roughly 30–60 seconds. The Starter plan (about $7/month) stays awake.
- **Games reset when the server restarts.** That happens when you upload changes, when Render restarts it, or when a free server goes to sleep. Saving games is a good later upgrade.
- **Refreshing is safe.** A player who reloads or loses connection rejoins the same seat with their hand and money.
- **Changing cards:** edit `cards.js` on GitHub (open the file, click the pencil, save). Render rebuilds automatically.

## Run it on your own computer (optional)
Install Node.js 18 or newer from https://nodejs.org, then in this folder run:

```
npm install
npm start
```

Open http://localhost:3000. Other people on the same Wi-Fi can join using your computer's local address, such as `http://192.168.1.20:3000`.
