# Meowcert

A Reddit-native rhythm game where every post is a stage and your cats are the headliners.

Meowcert is a cozy async-social rhythm game built on Devvit. Each Reddit post is a player's stage — visitors tap to the host's authored beat and the host's cats meow the melody. Decorate your cats, write your beat, drop the post.

## How it plays

- **Decorate.** Pull cats and cosmetics, dress them up, pick a backdrop. Your stage is your house.
- **Write a beat.** A 3-lane step sequencer with tempo and vibe pickers. Save your chart and the game picks a matching Suno backing track from the catalog — same chart always plays the same song.
- **Drop a post.** Your stage goes live on Reddit. Visitors land on it, tap through the round, and your cats meow the melody on the beat.

## Built with

- [Devvit Web](https://developers.reddit.com/) — Reddit's developer platform
- [Phaser 4](https://phaser.io/) — 2D game engine
- [Hono](https://hono.dev/) — server runtime
- [Vite](https://vite.dev/) + [TypeScript](https://www.typescriptlang.org/) — client build + type safety

In-repo content pipeline: drag-drop calibrators for cats, cosmetics, themes, and music with server-side `sharp` recoloring and `ffmpeg` audio processing. The shared catalogs are auto-generated from the calibrator JSON so the game tracks edits in real time.

## Built for

[Reddit Games with a Hook](https://redditgameswithahook.devpost.com/) — Devpost hackathon.

## Development

```bash
npm run dev           # devvit playtest + vite watcher
node tools/server.mjs # content calibrators at http://localhost:3000
npm run build         # build client + server
npm run deploy        # publish a new version
npm run type-check    # type check + lint
```

Node 22+ required.

## Credits

Built on the [Devvit Phaser starter template](https://github.com/phaserjs/template-vite-ts). Cat art and animations adapted from the original `pspsadopt` Telegram prototype.
