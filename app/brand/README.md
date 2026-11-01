# Nuvolve brand

The mark is a shield (the protection a pest company sells) with an N drawn as a route: two stops joined by the path a tech drives.

| File | Use |
| --- | --- |
| `nuvolve-mark.svg` | The shield alone, transparent background |
| `nuvolve-icon.svg` | App icon: the shield on a dark rounded square |
| `nuvolve-icon-maskable.svg` | Full-bleed icon for Android / PWA masks |
| `nuvolve-logo.svg` | Shield + wordmark, dark ink for light backgrounds |
| `nuvolve-logo-light.svg` | Shield + wordmark, white ink for dark backgrounds |
| `nuvolve-wordmark.svg` | Wordmark alone (`currentColor`) in Big Shoulders Display Black, outlined |
| `nuvolve-3d.png`, `nuvolve-3d-hero.jpg` | Blender renders (`scripts/brand/render-3d.py`) |
| `/icons/nuvolve.svg`, `/icons/favicon.ico` | Favicon: a bolder shield without the stop dots so it reads at 16px |

Colors: forest `#1f2d27`, green `#2f855a` (gradient `#38a169` → `#22543d`), mint `#7ee2a8`, white.

Re-render the 3D mark: `blender -b -P scripts/brand/render-3d.py -- out.png transparent 256 1024 1024` (or `hero 256 1600 900`).

## Launch animation

`nuvolve-splash.mp4` / `.webm` (about 150 KB, 2.5 s, 720×720) play once per visit as a splash on the office app, the tech app and the customer portal (`public/js/splash.js`). The outline traces in, the shield rises, the route draws with a spark of light, the two stops pop with a ripple and a glint sweeps across. It only plays when the connection can carry it: online, no Data Saver, no reduced motion, a connection the browser rates 4G-class, and the video ready within 0.9 s. Otherwise the page opens straight away with the still logo. A click or key press skips it.

## Tutorial intro and outro

`scripts/brand/brandfx.py` also renders 5-second 1080p intro and outro cards for tutorial videos (they are kept out of the app; download them from the project files). Routes on a dark street-map grid run into the mark, then the wordmark and tagline wipe in.

Render (Blender 4.0, EEVEE; needs `libegl1` on a headless box):

```
blender -b -P scripts/brand/brandfx.py -- splash out/splash 720 720 64
blender -b -P scripts/brand/brandfx.py -- intro  out/intro 1920 1080 24
blender -b -P scripts/brand/brandfx.py -- outro  out/outro 1920 1080 24
ffmpeg -framerate 30 -i out/splash/f_%04d.png -vf "tpad=stop_mode=clone:stop_duration=0.3,format=yuv420p" -c:v libx264 -crf 22 -movflags +faststart public/brand/nuvolve-splash.mp4
```

Fonts in `scripts/brand/fonts` are Big Shoulders Display and IBM Plex Mono (SIL Open Font License, included).
