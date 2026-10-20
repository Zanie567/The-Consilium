# Trading Challenge screenshots

Captured on 20 October 2026 from a local production build of this branch (Chromium),
so the page is in its **upcoming** state ("Registration open"). Light and dark are the
site themes.

- `desktop-*` 1440×900; `mobile-*` 375×812; `768-*` and `1024-*` tablet and small
  laptop (both use the menu drawer).
- `chart-1-on-load` → `chart-2-scrolling` → `chart-3-complete`: the hero chart at rest
  after loading, part way through the first scroll, and complete (1440×900, dark).
- `medals-*-3x`: the podium at 3× pixel ratio, to show the medal detail.
- `*-podium`: the podium after its entrance has finished.
- `*-glance*`: "Competition at a glance" and the official rules.
- `*-register-non-student`: the email contact panel for non-student members.
- `desktop-light-register-form-loaded` / `mobile-light-register-form-loaded`: the real
  student Google Form loaded inside the page (nothing was submitted).

The motion itself is in `../motion/` (WebM screen recordings of real scrolling):
`desktop-hero-chart` (1280×800, dark), `desktop-podium-steps` (1280×800, light, ending
with a switch between registration routes) and `mobile-hero-podium` (390×844).
