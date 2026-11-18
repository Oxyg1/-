# Kissed Dragon: AI storyboard

These are 12 key poses for a 3-second sticker (180 frames at 60 fps). I interpolate the in-betweens.
Generate each frame **as an edit of the reference** (`ref/concept-v2.jpg`) in Nano Banana or any image
model that can edit from a reference image. Don't generate frames from scratch: the character will drift.

## Rules for every frame (read before generating)

1. **Upload `concept-v2.jpg` as the reference with every request** and add the fixed preamble below.
2. The camera, scale and canvas must not change. The dragon should not move around the frame.
   Whatever doesn't move in a beat (feet, belly, tail) must line up with the reference pixel for pixel.
   If a frame comes out shifted or rescaled, regenerate it or line it up yourself when tracing.
3. Generate fire and smoke in the frames **for reference only** (so we can see placement and size).
   They're built separately as vector FX, so you don't need to trace them.
4. Choose one variant per beat. Look at the pose and the silhouette, not at the rendering.
   We trace contours only.

### Preamble (paste at the start of every prompt)

```
Edit the attached image. Keep EXACTLY the same character design, proportions, colors, line weight,
glossy cartoon sticker style, camera angle, framing, character size and position on the canvas,
and the same flat dark navy background. Do not add new characters, objects or text.
Change only the pose described below:
```

## Key poses

| # | Frame | Beat | Prompt (after the preamble) |
|---|---|---|---|
| K0 | 0 | Idle, profile | *(this is the reference itself, nothing to generate)* |
| K1 | 14 | Anticipation before the turn | `The dragon's head tilts very slightly back and away from the viewer, chin lifted a little, eye half-closed in a lazy blink. Body unchanged.` |
| K2 | 24 | Head mid-turn | `The dragon's head is halfway through turning toward the viewer: three-quarter view, the snout points to the lower left and is foreshortened, the second (far) eye just appears on the left side of the face behind the snout bridge. Horns and spikes follow the head rotation. Body, legs, wing and tail unchanged.` |
| K3 | 34 | Looking into the camera | `The dragon's head is turned three-quarters toward the viewer and it looks straight into the camera with both big round eyes visible, snout pointing lower-left and foreshortened, a smug little smile with the fang showing. Body, legs, wing and tail unchanged.` |
| K4 | 46 | Inhale | `Three-quarter head toward the viewer. The dragon takes a huge breath: chest and belly puffed up, cheeks inflated, head raised and tilted back, eyes squinting with determination, mouth tightly shut, wing lifted higher. Feet stay planted.` |
| K5 | 54 | Fire blast (in two steps, see below) | **Step 1** (edit K4): `The dragon is STILL SITTING on the ground exactly like in the reference, like a fat frog: all four feet flat on the ground, belly resting on the ground, tail lying on the ground, the wing stays small and folded as in the reference, NOT spread, NOT flying, NOT jumping. Only the head changes: three-quarter toward the viewer, jaw dropped wide open, tongue visible, eyes wide, the head pushed slightly forward. No fire yet.` **Step 2** (edit the result of step 1): `Do not change the dragon at all. Add a cartoon fire blast coming out of its open mouth to the LEFT and slightly down, widening into big billowing flames toward the left edge.` |
| K6 | 75 | Peak of the blast | Edit K5, also in two steps. **Step 1**: `Do not change the body, feet, belly, tail or wing — the dragon stays sitting on the ground. Only the head: cheeks pushed back by effort, eyes squeezed, mouth still wide open.` **Step 2**: `Do not change the dragon. Make the fire coming out of its mouth bigger, filling the left part of the image.` |
| K7 | 98 | Fire cut off | `Three-quarter head toward the viewer. The fire has just stopped: mouth closing, a big round puff of grey cartoon smoke coming out of the mouth, the dragon looks surprised with wide eyes, body slightly bounced up.` |
| K8 | 112 | Embarrassed, the hind paw lifts | `Three-quarter head toward the viewer. Grey cartoon smoke puffs float around the snout. The dragon looks embarrassed, eyes squinting sheepishly, and lifts its HIND (back) leg up toward its face like a frog or a dog scratching, the hind foot rising near the cheek. Front legs, belly and tail stay in place.` |
| K9 | 124 | Wave up | `Same pose: the dragon's hind foot is raised high in front of its snout, fanning the smoke away with an upward swipe; the smoke puffs are pushed up and to the left. Embarrassed squint.` |
| K10 | 132 | Wave down | `Same pose: the hind foot swipes down and outward, smoke puffs scatter to the left and break into smaller puffs. Embarrassed squint.` |
| K11 | 160 | Back to profile | `The hind leg is back on the ground. The dragon turns its head back to profile (as in the original image), eyes closed in a blink, a last tiny wisp of smoke from the nostril.` |

K11 then interpolates into K0 (frame 180 equals frame 0), so the loop is seamless.

## If the model insists on making the dragon fly

Models link "dragon + fire" to flight and redraw the whole body. Here's what helps, in order:
1. **Two steps** (as in K5/K6): first the open mouth with no fire, then add the fire with "do not change the dragon".
2. **Edit only the head area**: if the tool has a brush or selection (inpaint), paint over the head only and
   send the prompt for the head. The body physically can't change then.
3. **Add a ban at the end of the prompt:** `Negative: flying, airborne, spread wings, jumping, standing up, legs off the ground.`
4. If it still flies: draw the fire yourself or take it from the previous frame. For tracing, only the
   dragon's pose matters, and the fire is vector FX anyway.

## What to send back

The chosen frames named `K1.png` … `K11.png` (the same size as the reference, 2000×1609).
I'll check that they're aligned and then we move on to tracing the contours (instructions and the
contour template come in the next step).
