# MyKin: experience design

North star: `docs/blueprint/mykin-concept.png` and the brief: *build MyKin as an emotionally
engaging, cinematic 3D creature experience, not a conventional dashboard or 3D tech demo. The
creature must command attention, the environment must feel alive, and the interface must reveal
itself only when useful.*

## Three principles
1. **Pixar-quality creature, Tesla-quality interface.** The KIN is expressive and fills the frame.
   The UI is restrained translucent glass with a hairline highlight, Fraunces for names and titles,
   Geist for everything else, and colour only where it means something (action tiles, rings).
2. **The world is alive.** Habitats are lit by the real sky (sun angle and colour, golden and blue
   hour, stars, moon, real wind in the grass, rain and snow), with ambient motion everywhere
   (drifting cloud sea, spores and fireflies, water shimmer, crystal glow) and no empty darkness.
3. **Every interaction is rewarding, without menus in the way.** Care stays physical (drag the
   berry, flick the ball); the action bar only *coaches* it with a glowing ring on the real thing.

## The interface reveals itself only when useful
| State | What shows |
|---|---|
| Idle (default) | The KIN and its world. The top line (name, temperament, weather, time) fades to 60%. |
| Touch / mouse / key | The floating action bar rises: **Feed · Play · Explore · Train · Customize · Camera**. Recedes 6 s after the last interaction, never while a sheet is open or focused. |
| ≥ 1024 × 680 | The concept layout: left nav, identity + Today panels, bottom habitat strip, large action tiles. Recedes too. |
| Camera | Portrait framing, all UI gone, a shutter. Shares via the system sheet or downloads. |
| AR (`html.kin-ar`) | Same controls over the live room, darker glass, no habitat strip; Camera uses the AR shutter. |
| Party / crossing | Every control disappears (`setPresence('party')`). |

Honesty rule: Party, Sports and Customize show **Soon** and an explanation that routes to what
exists today. Unbuilt habitats say **Not built yet**; built-but-locked ones say the bond level.

## KIN Spotlight (src/render/camera.ts)
| Shot | Use | Phone framing* | Tilt |
|---|---|---|---|
| spotlight | default solo | 3.5 | 9° |
| closeup | eating, petting | 2.4 | 7.5° |
| wide | throws, fetch | 5.4 | 14° |
| party | many KIN | fits everyone | 20° |
| portrait | Camera mode | 2.7, rule of thirds | 6.5° |
| crossing | any peer present | **exactly the Stage baseline** (zoom 1, 31°) | 31° |

*World units of visible height; tablets and desktops show more habitat. Damped critically (no
overshoot), look-ahead from velocity, idle breathing drift (never while crossing), cuts instead of
moves under reduced motion. The crossing baseline is the seam contract in `src/render/choreo.ts`.

## Habitats (src/habitat)
- **Near:** a floating island whose play band is dead flat (y = 0, tested) so physics, toys and
  hops behave identically; props keep clear of the play band and the stage's anchors.
- **Far:** a camera-facing backdrop layer (the stage is orthographic, so distance is staged, not
  projected): sky gradient, real sun/moon placement, stars, cloud sea, floating islands with
  waterfalls, ridges, all hung on the horizon wherever the current shot puts it, with parallax.
- Sky Meadow (default), Forest Grove (bond 2), Crystal Cave (bond 3); four more shown as not built.
- Quality ladder by device (`habitatQuality()`): grass 2.6k / 4.6k / 7.6k blades, flowers 90–280.

## Accessibility
Every control is a labelled button; sheets are dialogs that take focus; Escape closes; rings are
`role=meter`; reduced motion turns moves into fades and cuts; the capture cue is a soft fade (no
flashes); touch targets ≥ 44 px; text contrast on glass ≥ 4.5:1 for body copy.
