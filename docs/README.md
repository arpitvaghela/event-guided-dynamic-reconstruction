# Project page

The static site served at
<https://arpitvaghela.github.io/event-guided-dynamic-reconstruction/>.
No build step: `index.html` plus `assets/`. Four blocks, roughly three pages of scroll — title and
teaser, method, results, citation.

The code documentation lives in the [repository README](../README.md); this file only covers the
page itself.

## Preview locally

```bash
python3 -m http.server 8000 --directory docs
```

Then open <http://localhost:8000>. `http.server` sends no cache-busting headers, so hard-reload
(Cmd+Shift+R) if an edit does not show up.

## Publishing

GitHub Pages serves this folder directly. In the repository: **Settings → Pages → Source → Deploy
from a branch**, branch `main`, folder **`/docs`**. Pushing to `main` redeploys.

`.nojekyll` stops GitHub from running Jekyll over the asset folders. Every path in `index.html` is
relative, so the page also works from a custom domain or a different subpath without edits.

## Before publishing

- **arXiv link.** All 3 arXiv buttons are marked `data-arxiv` and point at `#`. Search `index.html`
  for `data-arxiv` and replace the `href="#"` values. The script disables these buttons while the
  href is `#`, so they activate on their own once set.
- **BibTeX.** The entry in the `#paper` section is built from paper metadata, not an official
  citation.

There is deliberately no footer, acknowledgements block or author email list on the page — those
were removed, not lost. The acknowledgement text lives in the repository README instead.

## Design notes

- **Type.** [Literata](https://fonts.google.com/specimen/Literata) for prose and headings, a serif
  drawn for screen reading rather than print. Inter carries tables, labels and buttons, where
  tabular figures matter.
- **Colour.** Paper white with a faint warm cast (`--paper: #FFFAFA`) and periwinkle in two steps
  of one hue: `--accent-tint: #CCCCFF` fills buttons and the highlighted table row behind dark
  text, and `--accent: #4D4DD5` handles links, labels and borders, since the tint only reaches
  1.5:1 against the paper and cannot be text. Event-camera polarity red and blue stay out of the
  interface, used only where they carry meaning: the mark, and the gradient across the italic
  title line.
- **Motion.** One moment only: the title resolves out of blur on load, which is what the method
  does. Disabled under `prefers-reduced-motion`, where the looping videos also gain controls so they
  stay watchable.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The whole page |
| `assets/css/site.css` | Styles |
| `assets/js/site.js` | Scene tabs, viewport-gated video, citation copy, table scroll hints |
| `assets/figures/*.webp` | Paper figures, rendered from the LaTeX PDFs |
| `assets/video/*.mp4` | Clips cut from the qualitative results video |
| `assets/pdf/` | The paper |

Used by the page: figures `teaser`, `pose-viz`, `pipeline`, and the three `comparison-*.mp4` clips
with their posters.

Present but unreferenced, kept in case sections get added back: figures `blur-levels`, `data-gen`,
`edi-init`, `supp-plots`; clips `blur-01.mp4` and `blur-02.mp4`; and
`qualitative-results-full.mp4`, the full 78 s video. That last file is 13 MB of the repository's
29 MB of video — delete it if nothing will link to it.

## Regenerating assets

Figures, from the paper source (needs `poppler` and `webp`):

```bash
pdftocairo -png -singlefile -scale-to-x 2400 -scale-to-y -1 figures/methodology.pdf pipeline
cwebp -q 84 -m 6 -sharp_yuv pipeline.png -o docs/assets/figures/pipeline.webp
```

Video clips, from `Qualitative_Results_EGDR.mp4` (needs `ffmpeg`):

```bash
ffmpeg -ss 2.00 -t 11.65 -i Qualitative_Results_EGDR.mp4 -an \
  -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p \
  -movflags +faststart -r 16 docs/assets/video/comparison-01.mp4
```

Clip boundaries in the source video: comparisons at 2.00–13.65, 13.85–30.55 and 32.40–51.05 s
(the last cropped with `crop=1280:556:0:64` to drop empty padding), blur levels at 53.55–63.35 and
63.65–76.85 s. Each clip's `data-ar` attribute in `index.html` must match its pixel aspect ratio, or
the page shifts when switching tabs.
