# Event-Guided Dynamic Reconstruction under Extreme Motion Blur — project page

Static project page for the NeurIPS 2026 Workshop on Physical World AI paper.
No build step: `index.html` plus `assets/`.

Four blocks, roughly three pages of scroll: title and teaser, method, results, citation.

## Preview locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Publish on GitHub Pages

```bash
git init
git add .
git commit -m "Add project page"
git branch -M main
git remote add origin git@github.com:<user>/<repo>.git
git push -u origin main
```

In the repository, go to **Settings → Pages**, set *Source* to **Deploy from a branch**, branch
`main`, folder `/ (root)`. The page appears at `https://<user>.github.io/<repo>/`.

All asset paths are relative, so the page works from a repository subpath or a custom domain
without changes. `.nojekyll` stops GitHub from running Jekyll over the files.

## Before you publish

- **arXiv link.** Every arXiv button is marked `data-arxiv` and points at `#`. Search `index.html`
  for `data-arxiv` and replace the three `href="#"` values with the real URL. The script disables
  these buttons while the href is `#`, so they activate on their own once you set it.
- **BibTeX.** The entry in the `#paper` section is built from the paper metadata. Replace it with
  the official citation once the proceedings entry exists.
- **Code link.** There is no code button. To add one, copy a `.pill` anchor in the nav or the
  `#paper` actions row.

## Design notes

- **Type.** [Literata](https://fonts.google.com/specimen/Literata) for prose and headings — a serif
  drawn for screen reading, low contrast and sturdy rather than a print old-style. Inter carries the
  tables, labels and buttons, where tabular figures matter.
- **Colour.** Paper white with a yellow cast (`--paper: #FDFCF5`). The two accents are event-camera
  polarity, ON red and OFF blue, used as a pair rather than as a single highlight colour.
- **Motion.** One moment only: the title resolves out of blur on load, which is what the method
  does. It is disabled under `prefers-reduced-motion`, where the looping videos also gain controls
  so they stay watchable.

## Contents

| Path | What it is |
| --- | --- |
| `index.html` | The whole page |
| `assets/css/site.css` | Styles |
| `assets/js/site.js` | Scene tabs, viewport-gated video, citation copy, table scroll hints |
| `assets/figures/*.webp` | Paper figures, rendered from the LaTeX PDFs |
| `assets/video/*.mp4` | Clips cut from the qualitative results video, plus the full 78 s version |
| `assets/pdf/` | The paper |

There is no footer, acknowledgements block or author email list on the page; those were removed on
request, so add them back deliberately rather than assuming they were lost.

Used on the page: figures `teaser`, `pose-viz`, `pipeline`, and the three `comparison-*.mp4` clips
with their posters.

Present but not referenced, kept in case you want to add sections back: figures `blur-levels`
(qualitative comparison at all three blur levels), `data-gen` (how the benchmark is synthesized),
`edi-init` (event-aided pose estimation), `supp-plots` (per-scene trajectories); clips `blur-01.mp4`
and `blur-02.mp4`; and `qualitative-results-full.mp4`, the full 78 s video. That last file is 13 MB
of the repository's 29 MB of video — delete it if nothing is going to link to it.

## Regenerating assets

Figures, from the paper source (needs `poppler` and `webp`):

```bash
pdftocairo -png -singlefile -scale-to-x 2400 -scale-to-y -1 figures/methodology.pdf pipeline
cwebp -q 84 -m 6 -sharp_yuv pipeline.png -o assets/figures/pipeline.webp
```

Video clips, from `Qualitative_Results_EGDR.mp4` (needs `ffmpeg`):

```bash
ffmpeg -ss 2.00 -t 11.65 -i Qualitative_Results_EGDR.mp4 -an \
  -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p \
  -movflags +faststart -r 16 assets/video/comparison-01.mp4
```

Clip boundaries in the source video: comparisons at 2.00–13.65, 13.85–30.55 and 32.40–51.05 s
(the last cropped with `crop=1280:556:0:64` to drop empty padding), blur levels at 53.55–63.35 and
63.65–76.85 s. Each clip's `data-ar` attribute in `index.html` must match its pixel aspect ratio,
or the page will shift when you switch tabs.
