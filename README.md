# Prism — static GitHub Pages edition

This folder is a static website. Publish its contents at the root of a GitHub repository, choose **Settings → Pages → Build and deployment → GitHub Actions**, and push to the `main` branch. The included workflow deploys the site. If your default branch has a different name, update the workflow's branch name. `.nojekyll` keeps all static assets available. A private repository's Pages availability depends on its GitHub plan.

On Windows, double-click **Start Prism Web.bat** and keep its window open. It launches a localhost-only static server and opens the app in your browser; it requires no Python or installation. Close the window to stop it. Opening index.html directly cannot load the samples or the EXR decoder because browser file security blocks those requests. For macOS/Linux, serve this folder over HTTP on localhost with any static file server. No server is needed after deployment to GitHub Pages.

## Images

Choose a bundled BT.709, DCI-P3, or BT.2020 primary-flight gradient, or use **Open EXR files** / **Open folder**. Folder selection includes subfolders in browsers supporting directory selection. To rescan a changed folder, select it again. Images selected from your device are read and decoded in your browser and are not uploaded or stored by the app. Browsers require you to select the folder again after reloading.

EXRs are decoded to float in a worker using Three.js EXRLoader (0.180.0), with an additional unambiguous RGB-layer selection. NO, RLE, ZIP/ZIPS, PIZ, and DWA/B compression are supported by this decoder. Single-part flat RGB(A) and grayscale images are supported, including one unambiguous named RGB layer. Deep and multipart EXRs, subsampled channels, mixed RGB pixel types, some special channel layouts, and some compression features are not supported; an error is displayed. Large images are decoded at full resolution and then reduced to at most 4096 pixels on the longest edge for preview. Very large images can exceed browser memory. Color metadata is read when present; without usable metadata the existing AP0 fallback applies. The sample gradients carry embedded chromaticities.

## HDR

Select HDR extended range for supported browsers and HDR displays. Set peak, diffuse white, and **System SDR white** manually; the latter must match your system's SDR content brightness in nits. Browser APIs do not generally expose the Windows HDR calibration and SDR white values read by the local Windows helper. The optional **Detect HDR headroom** button requests screen permission and, when the browser exposes the experimental headroom value, estimates peak as entered system SDR white times headroom. This is an estimate, not an HDR calibration reading. When unavailable or declined, enter peak manually. Browser, operating system, compositor, and display determine actual HDR output. An HDR-capable display, WebGL floating point, and WebGPU extended-range canvas are required. PNG export is SDR.

This static edition does not read Windows HDR calibration or automatically scan local image folders.

## Licenses

The browser EXR decoder is derived from Three.js 0.180.0 (MIT); see THREE-LICENSE.txt and notices in EXRLoader.js and fflate.module.js. Included reference files retain their respective notices in reference/.
