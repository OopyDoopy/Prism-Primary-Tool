"""Bake the browser's ACES 1.3 LUT with numpy and opencolorio==2.6.0."""

from pathlib import Path

import numpy as np
import PyOpenColorIO as ocio


SIZE = 97
SOFTNESS = 0.01
LIMIT = 4096.0
XYZ_FROM_709 = np.array([
    [0.4123907993, 0.3575843394, 0.1804807884],
    [0.2126390059, 0.7151686788, 0.0721923154],
    [0.0193308187, 0.1191947798, 0.9505321522],
])


def processor():
    """Apply ACES RGC and SDR rendering to signed linear Rec.709."""
    chain = ocio.GroupTransform()
    to_xyz = np.eye(4)
    to_xyz[:3, :3] = XYZ_FROM_709
    to_709 = np.linalg.inv(to_xyz)
    chain.appendTransform(ocio.MatrixTransform(matrix=to_xyz.ravel().tolist()))
    chain.appendTransform(ocio.BuiltinTransform(
        style="UTILITY - ACES-AP0_to_CIE-XYZ-D65_BFD",
        direction=ocio.TRANSFORM_DIR_INVERSE,
    ))
    chain.appendTransform(ocio.BuiltinTransform(
        style="ACES-LMT - ACES 1.3 Reference Gamut Compression",
    ))
    chain.appendTransform(ocio.BuiltinTransform(
         style=("ACES-OUTPUT - ACES2065-1_to_CIE-XYZ-D65"
             " - SDR-VIDEO-REC709lim_1.1"),
    ))
    chain.appendTransform(ocio.MatrixTransform(matrix=to_709.ravel().tolist()))
    return ocio.Config.CreateRaw().getProcessor(chain).getDefaultCPUProcessor()


def main():
    stops = np.linspace(-1, 1, SIZE) * np.arcsinh(LIMIT / SOFTNESS)
    domain = SOFTNESS * np.sinh(stops)
    b, g, r = np.meshgrid(domain, domain, domain, indexing="ij")
    rgba = np.ones((SIZE, SIZE, SIZE, 4), dtype=np.float32)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = r, g, b
    processor().applyRGBA(rgba.reshape(-1, 4))
    if not np.isfinite(rgba).all():
        raise ValueError("Non-finite ACES output")
    output = Path(__file__).resolve().parents[1] / "aces13-signed.bin"
    rgba.astype("<f4", copy=False).tofile(output)


if __name__ == "__main__":
    main()
