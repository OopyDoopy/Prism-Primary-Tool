# Prism

Prism is a tone mapping system with **primary authoring controls**. It combines an authored color transformation, creative grading, a per-channel tonal response, and optional output gamut handling. The goal is to let you shape how colors and highlights behave through the tone mapper, rather than relying on a fixed set of primary transforms.

This repository provides a browser-based authoring and preview tool, along with a reference Prism shader. **Bring your own scene-linear EXRs** to evaluate a tuning against the images and color ranges you actually work with. Three bundled primary-flight gradients are included for diagnostics, not as a substitute for testing real content.

## Getting started

On Windows, double-click **Start Prism Web.bat**. It starts a localhost-only server and opens the tool in your browser; leave its window open while using Prism. No Python or installation is required.

On macOS or Linux, serve the repository over HTTP on localhost with a static file server. The site can also be hosted as a static website. Opening `index.html` directly from disk cannot load the EXR decoder or bundled images because of browser file security.

### Test your images

1. Select **Open EXR file** or **Open EXR folder** in the image preview and choose your scene-linear images. Use the image selector or arrow buttons to switch between them. Folder selection includes subfolders in supporting browsers; select the folder again to rescan changes.
2. Check **EXR source color space** and the source status below the preview. Auto uses supported EXR color metadata where available, then filename hints, and falls back to ACES2065-1 / AP0 when it cannot identify a source. Override the selection if necessary; an incorrect source space changes the result.
3. Select **Prism** as the tone mapper. Try **Prism Default**, then adjust the primary, tone, and grading controls while comparing several of your images. Prism Default is inspired by AgX, not an exact reproduction of its full transform.
4. Use the split slider to compare the exposure-adjusted source on the left with the tone-mapped result on the right. Use **Gamut warning** to inspect output against a selected gamut, or **Save SDR PNG** to export the preview.

Selected images are decoded locally in your browser; they are not uploaded or stored by the app. Browser settings are saved locally in a cookie when available, but files and folders must be selected again after reloading.

## How Prism works

Prism's public shader path accepts linear BT.709 values. The preview converts the selected source color space to BT.709 and applies exposure before passing the image through the following stages:

1. **Inset:** an authored matrix maps the input into Prism's formation basis. Its primaries and white point determine how colors are arranged before the nonlinear stages.
2. **Chroma and tonal grading:** saturation, highlight saturation, blowout, contrast, and tonal controls adjust the formation-space signal.
3. **Shoulder:** a selectable per-channel C∞ shoulder compresses highlights toward the output peak, with a configurable white-clip input.
4. **Outset:** a matrix maps the formed values back to linear BT.709. Inset, per-channel grading and shoulder, and outset together determine the resulting color and hue behavior.
5. **Gamut handling:** optionally compress or clip to BT.709, Display P3, or BT.2020. The preview then displays the result in SDR or, when supported, HDR.

Gamut handling is optional. The separate preview **Gamut warning** is a diagnostic, not a gamut-mapping operation. Selecting a wider target does not make an SDR sRGB preview a wide-gamut display.

**Compress output** uses a smooth radial limiter after the shoulder and chroma grading, testing both zero and the selected peak in target RGB. It normally preserves XYZ Y, but smoothly raises the neutral luminance toward a floor of 85% of the clipped target’s Y when signed channels would otherwise darken saturated colors. The final output clip remains as a fallback if the neutral is outside the target cube. **Output clip** skips the radial limiter. Neither mode applies pre-shoulder formation compression. In both HLSL variants, mode `1` now compresses output; mode `2` remains output-only clipping.

## Primary authoring

The **CIE 1931 xy primary authoring** section defines the matrix geometry. Choose a reference gamut, then adjust global and per-primary **reach** and **hue offset**. Reach moves a primary along its ray relative to the reference boundary; hue rotates its direction around the authored white. Master strength scales the adjustments. Primary extrapolation permits reach beyond the boundary; normalized LMS is treated as a signed basis.

Set the shared authoring white using a preset or temperature and tint. Prism constrains the white to the reference hull for non-LMS bases when needed. Extreme settings may produce a singular or near-singular transform; check the solver status and diagnostics.

Prism uses the inward primary inset construction and the exact inverse of that inset as its outset. The earlier working-basis construction and independently authored outset controls are no longer available. Existing presets retain their primary and grading settings but will render differently because the outset has changed.

Saved settings for the removed mode and independent outset controls are ignored; their previous appearance cannot be preserved automatically. The former C++ primary authoring reference has been removed; integrations using it must obtain resolved formation data from the primary tool or implement their own solver.

**Inset basis scale** is an experimental control applied after primary authoring. It scales each inset primary's xy displacement from the authored white: 1 retains the authored basis, smaller values contract it, and larger values expand it, potentially beyond the reference gamut. The outset is recalculated as the inverse of the scaled inset. Formation-space grading and the CIE geometry use the scaled basis. The scale preserves xy ray directions and relative distances, not perceptual uniformity; its effect can overlap with global reach. The browser limits it to 0.05–2 because zero collapses the basis. Extreme settings can still be singular or near-singular and are reported by the browser solver.

**Prism Default** in the primary presets changes primary authoring without resetting tone or grading controls. Prism Default primaries are used initially when no saved settings exist. **Prism Default** under **Output and tone** applies the broader tuning. **Set Neutral** in primary authoring sets neutral primary slider positions relative to the selected reference gamut while preserving the white; the global button also neutralizes grading and resets other tuning controls. Individual primary and grading slider reset buttons return to neutral; other slider resets restore their defaults.

The **Prism Recommended** curve preset applies the Prism Default grade without changing primaries, gamut handling, or the shoulder. **Set Neutral** in grading restores neutral grading values without changing primary authoring.

## Tone, grading, and diagnostics

Chroma grading runs after the shoulder and before the outset in the browser and both HLSL variants. It keeps the scene-driven highlight response and softens net saturation increases near Prism’s nonnegative RGB boundary. Output clipping can cap the final ray; output compression instead receives the uncapped ray.

- **Exposure** adjusts the input in stops. **Compression strength** and **White clip** shape the Prism shoulder; white clip is applied to the signal entering the shoulder after grading, not directly to the original EXR values.
- **Prism shoulder** selects the original curve or an experimental C∞ Reinhard-based curve. The latter smoothly joins an identity region to a Reinhard core, with a smooth input warp that reaches the peak at finite white clip. Compression strength applies only to the original shoulder; Reinhard uses white clip without a strength control. It is not the standard global Reinhard operator. The effective white clip is raised above the peak when needed.
- **Anchor in** and **Anchor out** set the tonal grading reference. Contrast, highlight and shadow controls, and deep shadow shape the per-channel response. Choose anchored or sign-preserving POW contrast.
- **Saturation**, **Highlight sat.**, and **Blowout / dechroma** combine into one post-shoulder chroma adjustment at constant XYZ Y.
- The **CIE xyY** plot shows the reference and authored primary geometry, with luminance Y on the vertical axis. Drag to rotate, scroll to zoom, and double-click to reset. It is a geometry diagnostic, not a plot of final tone-mapped hue flight.
- The purity/blowout and tonal response charts show the current control responses. The matrix panel displays the resolved inset, outset, and related basis information; **Copy HLSL** copies the displayed data. Use `reference/prism.hlsl` in a RenoDX mod, or `reference/prism_standalone.hlsl` for a self-contained copy with MIT-licensed RenoDX helpers (`reference/RENODX-LICENSE.txt`). Include only one variant per shader. In both variants, `config::CreateResolved` defaults to Prism Default formation matrices. For custom primaries, supply matching inset, outset, and formation-to-XYZ matrices. The shader extracts Y weights from the XYZ matrix and uses equal formation RGB as neutral. Existing callers must drop the three former chroma-space arguments. Other grading and shoulder defaults are independent of the browser preset.

The tone mapper selector also offers Hable, Reinhard, ACES 1.3 and Blender AgX SDR references, and PsychoV35 for comparison. These are separate transforms, not Prism presets; Prism-specific controls apply when Prism is selected.

The ACES 1.3 reference uses a signed 97³ LUT generated by `tools/bake_aces13.py` (NumPy and OpenColorIO 2.6). It preserves negative scene-linear BT.709 components within its input domain, applies ACES 1.3 Reference Gamut Compression before the SDR Rec.709 output transform, and returns linear Rec.709 for the browser's display encoding. This is an SDR reference, not an ACES HDR output transform.

**Reference Gamut Compression (RGC)** defaults to On in ACES mode. Off uses a matching LUT baked with `tools/bake_aces13.py --no-rgc`, keeping the signed input shaper and SDR output transform unchanged.

## Image support and HDR

The browser decoder supports single-part flat RGB(A) and grayscale EXRs, including one unambiguous named RGB layer, with NO, RLE, ZIP/ZIPS, PIZ, and DWA/B compression. Deep and multipart EXRs, subsampled channels, mixed RGB pixel types, some special channel layouts, and some compression features are not supported. Large images are decoded at full resolution and then reduced to at most 4096 pixels on the longest edge for preview; very large images can exceed browser memory.

Select **HDR extended range** when using a supported browser and HDR display. It requires WebGL floating-point rendering and a WebGPU extended-range canvas. Nominal SDR white is linear 1.0; the HDR peak is specified in stops above it. This is a relative target, not a measurement of the display: the browser, operating system, compositor, and display determine the actual output. The tool does not read Windows HDR calibration. PNG export remains SDR.

## Publishing

For GitHub Pages, publish this repository at the site root and select **Settings → Pages → Build and deployment → GitHub Actions**. The included workflow deploys pushes to `main`; adjust its branch if necessary. `.nojekyll` keeps static assets available. GitHub Pages availability for private repositories depends on the GitHub plan.

## Licenses

The browser EXR decoder is derived from Three.js 0.180.0 (MIT); see `THREE-LICENSE.txt` and the notices in `EXRLoader.js` and `fflate.module.js`. Reference files retain their respective notices in `reference/`.
