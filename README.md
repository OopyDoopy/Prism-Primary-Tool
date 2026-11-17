# Prism

Prism is a tone mapping system with **primary authoring controls**. It combines an authored color transformation, creative grading, a per-channel tonal response, and optional output gamut handling. The goal is to let you shape how colors and highlights behave through the tone mapper, rather than relying on a fixed set of primary transforms.

This repository provides a browser-based authoring and preview tool, along with reference Prism shader and CPU authoring code. **Bring your own scene-linear EXRs** to evaluate a tuning against the images and color ranges you actually work with. Three bundled primary-flight gradients are included for diagnostics, not as a substitute for testing real content.

## Getting started

On Windows, double-click **Start Prism Web.bat**. It starts a localhost-only server and opens the tool in your browser; leave its window open while using Prism. No Python or installation is required.

On macOS or Linux, serve the repository over HTTP on localhost with a static file server. The site can also be hosted as a static website. Opening `index.html` directly from disk cannot load the EXR decoder or bundled images because of browser file security.

### Test your images

1. Select **Open EXR files** or **Open folder** in the image preview and choose your scene-linear images. Use the image selector or arrow buttons to switch between them. Folder selection includes subfolders in supporting browsers; select the folder again to rescan changes.
2. Check **EXR source color space** and the source status below the preview. Auto uses supported EXR color metadata where available, then filename hints, and falls back to ACES2065-1 / AP0 when it cannot identify a source. Override the selection if necessary; an incorrect source space changes the result.
3. Select **Prism** as the tone mapper. Try the **Natural** or **AgX-Like** preset, then adjust the primary, tone, and grading controls while comparing several of your images. AgX-Like is a Prism tuning inspired by AgX, not an exact reproduction of its full transform.
4. Use the split slider to compare the exposure-adjusted source on the left with the tone-mapped result on the right. Use **Gamut warning** to inspect output against a selected gamut, or **Save SDR PNG** to export the preview.

Selected images are decoded locally in your browser; they are not uploaded or stored by the app. Browser settings are saved locally in a cookie when available, but files and folders must be selected again after reloading.

## How Prism works

Prism's public shader path accepts linear BT.709 values. The preview converts the selected source color space to BT.709 and applies exposure before passing the image through the following stages:

1. **Inset:** an authored matrix maps the input into Prism's formation basis. Its primaries and white point determine how colors are arranged before the nonlinear stages.
2. **Chroma and tonal grading:** saturation, highlight saturation, blowout, contrast, and tonal controls adjust the formation-space signal.
3. **Shoulder:** a per-channel C∞ shoulder compresses highlights toward the output peak, with a configurable white-clip input.
4. **Outset:** a matrix maps the formed values back to linear BT.709. Inset, per-channel grading and shoulder, and outset together determine the resulting color and hue behavior.
5. **Gamut handling:** optionally compress or clip to BT.709, Display P3, or BT.2020. The preview then displays the result in SDR or, when supported, HDR.

Gamut handling is optional. The separate preview **Gamut warning** is a diagnostic, not a gamut-mapping operation. Selecting a wider target does not make an SDR sRGB preview a wide-gamut display.

## Primary authoring

The **CIE 1931 xy primary authoring** section defines the matrix geometry. Choose a reference gamut, then adjust global and per-primary **reach** and **hue offset**. Reach moves a primary along its ray relative to the reference boundary; hue rotates its direction around the authored white. Master strength scales the adjustments. Primary extrapolation permits reach beyond the boundary; normalized LMS is treated as a signed basis.

Set the shared authoring white using a preset or temperature and tint. Prism constrains the white to the reference hull for non-LMS bases when needed. Extreme settings may produce a singular or near-singular transform; check the solver status and diagnostics.

The two matrix construction modes have different meanings:

- **Working basis:** the authored primaries define a working space, and the inset and outset are an inverse pair.
- **AgX-style:** the inset and outset are independently authored formation transforms. The outset purity and hue controls alter the post-tone transform while sharing the inset's white. Outset hue offsets are relative to the inset hue. Zero outset purity uses the reference boundary; it does **not** generally make the outset the inverse of the inset.

**Natural** and **AgX-Like** in the primary presets change the primary authoring setup without resetting tone or grading controls. The presets under **Output and tone** set the broader Prism tuning. Individual reset buttons restore their corresponding controls.

## Tone, grading, and diagnostics

- **Exposure** adjusts the input in stops. **Compression strength** and **White clip** shape the Prism shoulder; white clip is applied to the signal entering the shoulder after grading, not directly to the original EXR values.
- **Anchor in** and **Anchor out** set the tonal grading reference. Contrast, highlight and shadow controls, and deep shadow shape the per-channel response. Choose anchored or sign-preserving POW contrast.
- **Saturation**, **Highlight sat.**, and **Blowout / dechroma** operate before the tonal curve. The chroma-basis selector chooses Prism / XYZ Y or MacLeod–Boynton / LMS behavior; output gamut handling remains a separate stage.
- The **CIE xyY** plot shows the reference and authored primary geometry, with luminance Y on the vertical axis. Drag to rotate, scroll to zoom, and double-click to reset. It is a geometry diagnostic, not a plot of final tone-mapped hue flight.
- The purity/blowout and tonal response charts show the current control responses. The matrix panel displays the resolved inset, outset, and related basis information; **Copy HLSL** copies the displayed data. The reference files `reference/prism.hpp` and `reference/prism.hlsl` contain the CPU authoring solver and shader implementation, respectively; the HLSL relies on RenoDX shader includes.

The tone mapper selector also offers Hable, Reinhard, ACES 1.3 and Blender AgX SDR references, and PsychoV35 for comparison. These are separate transforms, not Prism presets; Prism-specific controls apply when Prism is selected.

## Image support and HDR

The browser decoder supports single-part flat RGB(A) and grayscale EXRs, including one unambiguous named RGB layer, with NO, RLE, ZIP/ZIPS, PIZ, and DWA/B compression. Deep and multipart EXRs, subsampled channels, mixed RGB pixel types, some special channel layouts, and some compression features are not supported. Large images are decoded at full resolution and then reduced to at most 4096 pixels on the longest edge for preview; very large images can exceed browser memory.

Select **HDR extended range** when using a supported browser and HDR display. It requires WebGL floating-point rendering and a WebGPU extended-range canvas. Nominal SDR white is linear 1.0; the HDR peak is specified in stops above it. This is a relative target, not a measurement of the display: the browser, operating system, compositor, and display determine the actual output. The tool does not read Windows HDR calibration. PNG export remains SDR.

## Publishing

For GitHub Pages, publish this repository at the site root and select **Settings → Pages → Build and deployment → GitHub Actions**. The included workflow deploys pushes to `main`; adjust its branch if necessary. `.nojekyll` keeps static assets available. GitHub Pages availability for private repositories depends on the GitHub plan.

## Licenses

The browser EXR decoder is derived from Three.js 0.180.0 (MIT); see `THREE-LICENSE.txt` and the notices in `EXRLoader.js` and `fflate.module.js`. Reference files retain their respective notices in `reference/`.
