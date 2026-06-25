# Drop original mp3s here, then run:

    node scripts/audio/backdate-music-sections.mjs

The script slugifies each filename to match catalog ids, runs chorus detection, copies the source to ../sources/, reclips to public/assets/audio/backings/, re-extracts taps, and patches music.json with the new clipStartS.
