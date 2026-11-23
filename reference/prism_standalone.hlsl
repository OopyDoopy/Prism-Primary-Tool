#ifndef PRISM_STANDALONE_HLSL_
#define PRISM_STANDALONE_HLSL_

// Standalone Prism tone mapping. No external shader includes are required.
// Public entry points accept and return linear BT.709.
// Copy this file into your project and include it from your shader.
//   prism::Config cfg = prism::config::CreateResolved(1.f);
//   float3 mapped709 = prism::BT709(sceneLinear709, cfg);
//
// If using standalone, be sure to tune the grading controls.
//
// Primary authoring resolves the gamut hull, white point, primary controls,
// matrices, and XYZ Y basis before shader execution. The primary authoring tool
// resolves an inward inset and its inverse outset; the shader consumes the data.

namespace prism {

// ============================================================================
//  RenoDX shader helpers — vendored for standalone Prism
//  Copyright (c) 2025 Carlos Lopez Jr.; Neutwo copyright (c) 2026 Carlos Lopez
//  SPDX-License-Identifier: MIT — see RENODX-LICENSE.txt
//  Sources: math.hlsl, math/{sign,constants}.hlsl, and tonemap/neutwo.hlsl.
// ============================================================================
namespace dependencies {

static const float FLOAT_MIN = 1.17549435082228750797e-38f;

float DivideSafe(float dividend, float divisor, float fallback) {
  return divisor == 0.f ? fallback : dividend / divisor;
}

float3 DivideSafe(float3 dividend, float3 divisor, float3 fallback) {
  return float3(DivideSafe(dividend.x, divisor.x, fallback.x),
                DivideSafe(dividend.y, divisor.y, fallback.y),
                DivideSafe(dividend.z, divisor.z, fallback.z));
}

float3 CopySign(float3 magnitude, float3 sign_source) {
  return asfloat((asuint(magnitude) & 0x7FFFFFFFu) | (asuint(sign_source) & 0x80000000u));
}

float ZeroNaN(float value) { return isnan(value) ? 0.f : value; }

float3 ZeroNaN(float3 value) {
  return float3(ZeroNaN(value.x), ZeroNaN(value.y), ZeroNaN(value.z));
}

float Neutwo(float x, float peak) {
  return (peak * x) * rsqrt(mad(x, x, peak * peak));
}

}  // namespace dependencies
// ============================= End RenoDX helpers ===========================

static const int CONTRAST_FUNCTION_ANCHORED = 0;
static const int CONTRAST_FUNCTION_POW = 1;
static const int SHOUDER_CINFINITY_ROLLOFF = 0;
static const int SHOULDER_CINFINITY_REINHARD = 1;
static const int GAMUT_COMPRESSION_BT709 = 0;
static const int GAMUT_COMPRESSION_P3 = 1;
static const int GAMUT_COMPRESSION_BT2020 = 2;

// Prism Default primaries: BT.2020, D65, with the authored inset and inverse.
// Override the complete formation data together when using custom primaries.
// Linear RGB conversions between BT.709 and each D65 compression target.
#define BT709_TO_BT709 float3x3(1.f, 0.f, 0.f, 0.f, 1.f, 0.f, 0.f, 0.f, 1.f)
#define BT709_TO_P3 float3x3( \
  0.822462f, 0.177538f, 0.f, \
  0.033194f, 0.966806f, 0.f, \
  0.017083f, 0.072397f, 0.910520f)
#define P3_TO_BT709 float3x3( \
  1.224940f, -0.224940f, 0.f, \
  -0.042057f, 1.042057f, 0.f, \
  -0.019638f, -0.078636f, 1.098274f)
#define BT709_TO_BT2020 float3x3( \
  0.627404f, 0.329283f, 0.043313f, \
  0.069097f, 0.919540f, 0.011363f, \
  0.016391f, 0.088013f, 0.895595f)
#define BT2020_TO_BT709 float3x3( \
  1.660491f, -0.587641f, -0.072850f, \
  -0.124550f, 1.132900f, -0.008349f, \
  -0.018151f, -0.100579f, 1.118730f)

#define PRISM_DEFAULT_INSET float3x3( \
  0.549737516f, 0.371638297f, 0.078624190f, \
  0.139220197f, 0.719788111f, 0.140991690f, \
  0.089362351f, 0.175562933f, 0.735074705f)
#define PRISM_DEFAULT_OUTSET float3x3( \
  2.094701286f, -1.077278804f, -0.017422490f, \
  -0.372709243f, 1.649163258f, -0.276454015f, \
  -0.165634190f, -0.262917185f, 1.428551392f)
// Formation RGB to XYZ, corresponding to the default inset and outset.
#define PRISM_DEFAULT_INSET_TO_XYZ float3x3( \
  0.700666760f, 0.098003586f, 0.151785581f, \
  0.166907707f, 0.931377814f, -0.098285521f, \
  -0.161373328f, -0.074164267f, 1.324595363f)

struct Config {
  // Display and tonal reference values.
  float tone_map_peak;
  float3 anchor_in;
  float3 anchor_out;

  // Resolved formation data: outset is the inverse of inset.
  float3x3 inset_matrix;
  float3x3 outset_matrix;

  // Precomputed by the primary authoring tool or supplied by the integration.
  float3 y_weights;

  // Tone-map shoulder configuration.
  float cinfinite_rolloff_compression_strength;
  int contrast_function;

  // Grading controls.
  float highlight_intensity;
  float shadow_brightness;
  float contrast;
  float saturation;
  float highlight_saturation;
  float blowout;
  float deep_shadow;
  float highlight_definition;
  float shadow_softness;

  int gamut_compression_mode;
  float tone_map_white_clip;
  int shoulder_mode;
};

namespace config {

// Supply all formation arguments together to override Prism Default primaries.
Config CreateResolved(
    float tone_map_peak,
    float3 anchor_in = 0.18f,
    float3 anchor_out = 0.18f,
    float3x3 inset_matrix = PRISM_DEFAULT_INSET,
    float3x3 outset_matrix = PRISM_DEFAULT_OUTSET,
    float3x3 inset_to_xyz = PRISM_DEFAULT_INSET_TO_XYZ,
    float cinfinite_rolloff_compression_strength = 1.5f,
    int contrast_function = CONTRAST_FUNCTION_POW,
    float highlight_intensity = 1.f,
    float shadow_brightness = 1.f,
    float contrast = 1.f,
    float saturation = 1.f,
    float highlight_saturation = 1.f,
    float blowout = 0.f,
    float deep_shadow = 0.f,
    float highlight_definition = 1.f,
    float shadow_softness = 1.f,
    float tone_map_white_clip = 100.f,
    int shoulder_mode = SHOULDER_CINFINITY_REINHARD,
    // Compress to BT.709 for SDR or Display P3 for HDR (default).
    int gamut_compression_mode = GAMUT_COMPRESSION_P3) {
  const Config config = {
      tone_map_peak,
      anchor_in,
      anchor_out,
      inset_matrix,
      outset_matrix,
      inset_to_xyz[1],
      cinfinite_rolloff_compression_strength,
      contrast_function,
      highlight_intensity,
      shadow_brightness,
      contrast,
      saturation,
      highlight_saturation,
      blowout,
      deep_shadow,
      highlight_definition,
      shadow_softness,
      gamut_compression_mode,
      tone_map_white_clip,
      shoulder_mode
  };
  return config;
}

}  // namespace config

float ComputeCInfinityTransition(float position) {
  position = saturate(position);
  return 1.f / (1.f + exp2((1.f - 2.f * position) / (position * (1.f - position))));
}

float3 ComputeCInfinityTransition(float3 position) {
  position = saturate(position);
  return 1.f / (1.f + exp2((1.f - 2.f * position) / (position * (1.f - position))));
}

// XYZ Y of a color already expressed in the configured inset Prism basis.
float XYZY(float3 color, Config config) {
  return dot(color, config.y_weights);
}

// The authored white maps to equal formation RGB. Scale it to the requested Y.
float3 YNeutral(float y, Config config) {
  const float neutral = y / dot(config.y_weights, 1.f.xxx);
  return neutral.xxx;
}

// Scales the residual orthogonal to the XYZ Y functional.
// dot(result, y_weights) == dot(color, y_weights), apart from FP error.
float3 ApplyYChromaScale(float3 color, float chroma_scale, Config config) {
  const float y = XYZY(color, config);
  const float3 neutral = YNeutral(y, config);
  const float3 direction = color - neutral;
  // Outside the hull retain original chroma rather than abruptly applying
  // the full increase at the boundary.
  if (chroma_scale > 1.f && all(neutral >= 0.f.xxx)) {
    float boundary = 1e30f;
    [unroll] for (int i = 0; i < 3; ++i) {
      if (direction[i] < 0.f) boundary = min(boundary, neutral[i] / -direction[i]);
    }
    if (boundary < 1e29f) {
      const float headroom = max(boundary - 1.f, 0.f);
      chroma_scale = 1.f + (headroom > 0.f ? dependencies::Neutwo(chroma_scale - 1.f, headroom) : 0.f);
    }
  }
  return mad(direction, chroma_scale, neutral);
}

// Monotonic and C-infinity continuous anchored tonal grading.
//
// IMPORTANT:
// This function operates in the inset Prism basis.
float3 ApplyAnchoredTonalGrading(
    float3 color,
    float3 anchor_in = 0.18f,
    float3 anchor_out = 0.18f,
    float contrast = 1.f,
    float flare = 0.f,
    float highlight_contrast = 1.f,
    float shadow_contrast = 1.f,
    float highlights = 1.f,
    float shadows = 1.f,
    int contrast_function = CONTRAST_FUNCTION_POW) {
  [branch]
  if (contrast == 1.f
      && flare == 0.f
      && highlight_contrast == 1.f
      && shadow_contrast == 1.f
      && highlights == 1.f
      && shadows == 1.f
      && all(anchor_in == anchor_out)) {
    return color;
  }

  float3 ax = abs(color);
  float3 normalized = ax / anchor_in;
  float3 contrasted_normalized = normalized;

  if (contrast_function == CONTRAST_FUNCTION_POW) {
    float3 exponent = max(contrast, 0.f);
    [branch]
    if (flare > 0.f) {
      float3 shadow_distance = saturate(1.f - normalized);
      float3 flat_shadow_weight = exp2(-normalized / shadow_distance);
      exponent *= mad(flat_shadow_weight, flare / (normalized + flare), 1.f);
    }
    contrasted_normalized = pow(max(normalized, 1e-30f), exponent);
  } else {
    // Anchored contrast uses a bounded highlight response.
    [branch]
    if (contrast != 1.f || flare > 0.f) {
      float3 exponent = contrast;
      [branch]
      if (flare > 0.f) {
        float3 shadow_distance = saturate(1.f - normalized);
        float3 flat_shadow_weight = exp2(-normalized / shadow_distance);
        exponent *= mad(flat_shadow_weight, flare / (normalized + flare), 1.f);
      }
      float3 input_stops = log2(normalized);
      float3 highlight_stops = max(input_stops, 0.f);
      float3 output_highlight_stops = highlight_stops;
      [branch]
      if (contrast != 1.f) {
        float3 contrast_displacement = (contrast - 1.f) * highlight_stops;
        float3 displacement_magnitude = abs(contrast_displacement);
        output_highlight_stops += contrast_displacement
            / mad(displacement_magnitude, exp2(-1.f / displacement_magnitude), 1.f);
      }
      contrasted_normalized = exp2(mad(exponent, min(input_stops, 0.f), output_highlight_stops));
    }
  }

  // Broad highlight contrast.
  [branch]
  if (highlight_contrast != 1.f) {
    float3 highlight_distance = max(contrasted_normalized - 1.f, 0.f);
    float3 highlight_distance_squared = highlight_distance * highlight_distance;
    float3 flat_highlight_distance =
        (1.f + highlight_distance_squared)
        * exp2(-1.f / highlight_distance_squared);

    contrasted_normalized +=
        highlight_distance
        * (pow(1.f + flat_highlight_distance, 0.5f * (highlight_contrast - 1.f)) - 1.f);
  }

  // Broad shadow contrast.
  [branch]
  if (shadow_contrast != 1.f) {
    float3 shadow_distance = saturate(1.f - contrasted_normalized);
    float3 shadow_distance_squared = shadow_distance * shadow_distance;
    float3 flat_shadow_distance =
        shadow_distance_squared
        * shadow_distance
        * exp2(1.f - 1.f / shadow_distance_squared);

    contrasted_normalized *=
        pow(1.f + flat_shadow_distance, shadow_contrast - 1.f);
  }

  // Mirror offsets about the anchor:
  // start at one stop and reach full strength at eight stops.
  [branch]
  if (highlights != 1.f || shadows != 1.f) {
    float3 tonal_stops = log2(contrasted_normalized);
    float3 tonal_displacement = 0.f;

    [branch]
    if (highlights != 1.f) {
      float highlight_adjustment = highlights - 1.f;
      float highlight_displacement =
          highlight_adjustment * mad(1.5f, abs(highlight_adjustment), 0.5f);
      float3 highlight_weight =
          ComputeCInfinityTransition((tonal_stops - 1.f) / 7.f);
      tonal_displacement =
          mad(highlight_displacement, highlight_weight, tonal_displacement);
    }

    [branch]
    if (shadows != 1.f) {
      float shadow_adjustment = shadows - 1.f;
      float shadow_displacement =
          shadow_adjustment * mad(1.5f, abs(shadow_adjustment), 0.5f);
      float3 shadow_weight =
          ComputeCInfinityTransition((-1.f - tonal_stops) / 7.f);
      tonal_displacement =
          mad(shadow_displacement, shadow_weight, tonal_displacement);
    }

    contrasted_normalized *= exp2(tonal_displacement);
  }

  return dependencies::CopySign(contrasted_normalized * anchor_out, color);
}

float3 ApplyAnchoredPowContrast(
    float3 color,
    float3 anchor_in,
    float3 anchor_out,
    float contrast,
    float flare = 0.f) {
  float3 normalized = color / max(anchor_in, dependencies::FLOAT_MIN);
  float3 magnitude = abs(normalized);
  float3 exponent = max(contrast, 0.f);
  if (flare > 0.f) {
    float3 shadow_distance = saturate(1.f - magnitude);
    float3 weight = exp2(-magnitude / max(shadow_distance, 1e-9f));
    exponent *= 1.f + weight * flare / (magnitude + flare);
  }
  return sign(normalized) * pow(max(magnitude, 1e-30f), exponent) * anchor_out;
}

// White-clip C-infinity rolloff. At the endpoints use
// explicit branches to avoid zero/infinity indeterminacies.
float ApplyAnchoredCInfinityShoulder(float color, float peak, float anchor, float compression_strength, float white_clip) {
  const float magnitude = abs(color);
  peak = max(peak, anchor + 1e-6f);
  const float clip = max(white_clip, peak + max(peak * 1e-6f, 1e-6f));
  if (magnitude <= anchor) return color;
  if (magnitude >= clip) return sign(color) * peak;
  const float shoulder_range = peak - anchor;
  const float clip_range = clip - anchor;
  const float distance = magnitude - anchor;
  const float inverse_position = shoulder_range * (clip_range - distance) / ((clip - peak) * distance);
  const float weight = exp2(-inverse_position / max(compression_strength, 1.f));
  const float denominator = weight + inverse_position;
  const float transition = denominator > 0.f ? (distance / clip_range) * (weight / denominator) : 1.f;
  return sign(color) * mad(peak - clip, transition, magnitude);
}
float3 ApplyAnchoredCInfinityShoulder(float3 color, float peak, float3 anchor, float compression_strength, float white_clip) {
  return float3(ApplyAnchoredCInfinityShoulder(color.x, peak, anchor.x, compression_strength, white_clip),
                ApplyAnchoredCInfinityShoulder(color.y, peak, anchor.y, compression_strength, white_clip),
                ApplyAnchoredCInfinityShoulder(color.z, peak, anchor.z, compression_strength, white_clip));
}

// Reinhard core, smoothly joined to identity and a finite white-clip plateau.
float ApplyReinhardCInfinityShoulder(float color, float peak, float anchor, float white_clip) {
  const float magnitude = abs(color);
  peak = max(peak, anchor + 1e-6f);
  const float clip = max(white_clip, peak + max(peak * 1e-6f, 1e-6f));
  if (magnitude <= anchor) return color;
  if (magnitude >= clip) return sign(color) * peak;
  const float range = peak - anchor, length = clip - anchor, distance = magnitude - anchor;
  const float t = distance / length;
  const float q = log(2.f) * (2.f * t - 1.f) / (t * (1.f - t));
  const float log_warp = log(distance / range) + max(q, 0.f) + log(1.f + exp(-abs(q)));
  const float log_base = max(log_warp, 0.f) + log(1.f + exp(-abs(log_warp)));
  const float reinhard = range * (1.f - exp(-log_base));
  const float start_position = distance / min(range / 16.f, length * .25f);
  const float start = start_position >= 1.f ? 1.f : ComputeCInfinityTransition(start_position);
  return sign(color) * (anchor + lerp(distance, reinhard, start));
}
float3 ApplyReinhardCInfinityShoulder(float3 color, float peak, float3 anchor, float white_clip) {
  return float3(ApplyReinhardCInfinityShoulder(color.x, peak, anchor.x, white_clip),
                ApplyReinhardCInfinityShoulder(color.y, peak, anchor.y, white_clip),
                ApplyReinhardCInfinityShoulder(color.z, peak, anchor.z, white_clip));
}

// Post-shoulder chroma grading, driven by the original scene luminance.

float3 ApplyChromaScale(
    float3 color,
    float chroma_scale,
    Config config) {
  if (abs(chroma_scale - 1.f) <= 1e-5f) return color;

  return ApplyYChromaScale(color, chroma_scale, config);
}

// Compute highlight weight with smootherstep on anchor-relative XYZ luminance (Y).
// Start three quarters of a stop below the anchor; keep the full-strength point fixed.
float ComputePrismYHighlightRolloff(float3 color, Config config) {
  const float onset_offset = 0.75f;
  const float luminance = max(0.f, XYZY(color, config));
  const float anchor_luminance = max(XYZY(config.anchor_in, config), 0.000001f);
  const float relative_luminance = max(luminance / anchor_luminance, exp2(-onset_offset));
  const float position = saturate((log2(relative_luminance) + onset_offset) / (2.75f * log2(10.f) + onset_offset));
  return position * position * position
         * mad(position, mad(6.f, position, -15.f), 10.f);
}

float ComputeHighlightSaturationScale(float highlight_rolloff, Config config) {
  const float highlight_weight = highlight_rolloff * highlight_rolloff
                                 * mad(0.5f, highlight_rolloff, 0.5f);
  return mad(config.highlight_saturation - 1.f,
             highlight_weight * (2.f / 3.f),
             1.f);
}

float3 ApplyChromaGrading(float3 color, float highlight_rolloff, Config config) {
  const float strength = saturate(config.blowout * highlight_rolloff);
  const float availability = lerp(1.f, 1.f / (1.f + config.tone_map_peak / max(config.anchor_out.x, 1e-9f)), strength);
  const float amount = config.saturation * ComputeHighlightSaturationScale(highlight_rolloff, config) * availability;
  return ApplyChromaScale(color, amount, config);
}

// Smoothly limit gamut demand to one, avoiding cancellation near zero.
float GamutSmoothUnitLimit(float demand) {
  const float sharpness = 16.f;
  const float zero_offset = 1.f - log2(1.f + exp2(sharpness)) / sharpness;
  float near_zero = 0.f;
  if (!(demand >= 1e-3f)) {
    const float origin_slope = rcp(1.f + exp2(-sharpness));
    near_zero = demand * origin_slope
        * (1.f - 0.5f * sharpness * log(2.f) * (1.f - origin_slope) * demand)
        / (1.f - zero_offset);
    if (demand <= 1e-4f) return near_zero;
  }
  const float limited = 1.f
      - log2(1.f + exp2(sharpness * (1.f - demand))) / sharpness;
  const float mapped_demand = (limited - zero_offset) / (1.f - zero_offset);
  if (demand >= 1e-3f) return mapped_demand;
  const float transition_position = (demand - 1e-4f) / 9e-4f;
  const float transition = rcp(
      1.f + exp2((1.f - 2.f * transition_position)
                 / (transition_position * (1.f - transition_position))));
  return lerp(near_zero, mapped_demand, transition);
}

float3 BT709ToCompressionTarget(float3 color, int mode) {
  if (mode == GAMUT_COMPRESSION_P3) return mul(BT709_TO_P3, color);
  if (mode == GAMUT_COMPRESSION_BT2020) return mul(BT709_TO_BT2020, color);
  return color;
}

float3 CompressionTargetToBT709(float3 color, int mode) {
  if (mode == GAMUT_COMPRESSION_P3) return mul(P3_TO_BT709, color);
  if (mode == GAMUT_COMPRESSION_BT2020) return mul(BT2020_TO_BT709, color);
  return color;
}

// Post-shoulder compression along a Prism RGB ray against the target cube.
float3 CompressOutputGamut(float3 color, Config config) {
  const float peak = max(config.tone_map_peak, 1e-6f);
  const float3 target = BT709ToCompressionTarget(mul(config.outset_matrix, color), config.gamut_compression_mode);
  const float y = XYZY(color, config);
  const float3 visible = clamp(target, 0.f, peak);
  const float visible_y = max(XYZY(mul(config.inset_matrix, CompressionTargetToBT709(visible, config.gamut_compression_mode)), config), 0.f);
  // Magic numbers, not color-space standards: 0.85 is the recovery
  // floor as a fraction of clipped target XYZ Y (not display peak).
  // 0.15 is the smooth join's half-width, also relative to clipped Y.
  // These values are independent and need not sum to 1.
  const float floor_y = 0.85f * visible_y;
  const float width = 0.15f * visible_y;
  float recovered_y = max(y, floor_y);
  if (width > 0.f) {
    const float overlap = max(width - abs(y - floor_y), 0.f) / width;
    recovered_y += 0.25f * width * overlap * overlap;
  }
  const float3 neutral = YNeutral(recovered_y, config);
  const float3 origin = BT709ToCompressionTarget(mul(config.outset_matrix, neutral), config.gamut_compression_mode);
  if (any(origin < 0.f) || any(origin > peak)) return color;
  const float3 delta = target - origin;
  float demand = 0.f;
  [unroll] for (int i = 0; i < 3; ++i) {
    if (delta[i] == 0.f) continue;
    const float room = delta[i] < 0.f ? origin[i] : peak - origin[i];
    if (room == 0.f) return neutral;
    // The first cube face hit sets the limit; do not round off cube corners.
    demand = max(demand, abs(delta[i]) / room);
  }
  if (demand == 0.f) return color;
  const float scale = GamutSmoothUnitLimit(demand) / demand;
  return scale == 1.f ? color : neutral + (color - neutral) * scale;
}

// Apply only tonal grading; chroma grading requires the shoulder result.
float3 ApplyGradingOnly(float3 color, Config config) {
  color = ApplyAnchoredTonalGrading(
      color,
      config.anchor_in,
      config.anchor_out,
      config.contrast,
      config.deep_shadow,
      config.highlight_definition,
      config.shadow_softness,
      config.highlight_intensity,
      config.shadow_brightness,
      config.contrast_function);

  return color;
}

// Tonal grading, shoulder, then chroma, all in the formation basis.
float3 ApplyWithShoulder(float3 color, Config config) {
  const float highlight_rolloff = ComputePrismYHighlightRolloff(color, config);
  color = ApplyGradingOnly(color, config);
  if (config.shoulder_mode == SHOULDER_CINFINITY_REINHARD) {
    color = ApplyReinhardCInfinityShoulder(color, config.tone_map_peak, config.anchor_out,
      config.tone_map_white_clip);
  } else {
    color = ApplyAnchoredCInfinityShoulder(color, config.tone_map_peak, config.anchor_out,
        config.cinfinite_rolloff_compression_strength, config.tone_map_white_clip);
  }

  return ApplyChromaGrading(color, highlight_rolloff, config);
}

float3 Apply(float3 color, Config config) {
  return ApplyWithShoulder(color, config);
}

// Public BT.709 -> formation -> grade -> tone map -> output BT.709 path.
//
// Matrices follow RenoDX's convention:
//   formation = mul(inset_matrix, bt709);
//   bt709     = mul(outset_matrix, formation);
//
// outset_matrix is the inverse of inset_matrix.
//
// Output gamut compression defaults to Display P3; the return value is linear BT.709.
float3 BT709(float3 bt709, Config config) {
  float3 color = mul(config.inset_matrix, bt709);
  color = ApplyWithShoulder(color, config);
  color = CompressOutputGamut(color, config);
  const float3 target = BT709ToCompressionTarget(mul(config.outset_matrix, color), config.gamut_compression_mode);
  const float3 output709 = CompressionTargetToBT709(clamp(target, 0.f, max(config.tone_map_peak, 1e-6f)), config.gamut_compression_mode);
  return dependencies::ZeroNaN(output709);
}


}  // namespace prism

#endif  // PRISM_STANDALONE_HLSL_
