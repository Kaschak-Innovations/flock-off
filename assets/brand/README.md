# Flock Off brand sources

The mark is a bird in flight with a camera-aperture eye, its raised wing feathers forming a middle finger.

- `flock-off-bird.svg`: the full mark (six-blade aperture eye).
- `flock-off-bird-icon.svg`: simplified red eye that survives small sizes; used by the app icons.
- `flock-off-bird-mono.svg`: single-color silhouette for Android themed icons.
- `flock-off-lockup.svg` / `flock-off-lockup-dark.svg`: bird over the wordmark. The wordmark is Orbitron Bold (SIL Open Font
  License) converted to outlines, FLOCK in white and OFF in the app green.

Colors match the app: green #22C55E, red #EF4444, background #0A0B0E. `reference-bird-concept.jpg` is the concept the bird
was traced from; `reference-fo-concept.png` is the earlier FO monogram concept.

## Rebuilding

    pip install fonttools brotli uharfbuzz playwright potracer
    python3 assets/brand/tools/build_bird.py /tmp/brand-out

That renders every PNG into `/tmp/brand-out/png/` (icon, adaptive layers, splash, favicon, Play icon, feature graphic, lockup)
plus `preview.png`, which shows the icon at home-screen sizes and under launcher masks. `tools/trace.py` regenerates
`bird_path.txt` from the reference image if the drawing ever needs re-tracing.
