#ifndef RENODX_MOD_PRISM_HLSL_
#define RENODX_MOD_PRISM_HLSL_

#include "../../../shaders/color.hlsl"
#include "../../../shaders/color/macleod_boynton.hlsl"
#include "../../../shaders/color/gamut.hlsl"
#include "../../../shaders/tonemap/neutwo.hlsl"
#include "../../../shaders/math.hlsl"

// Prism tone mapping. This file is intended to live directly in a RenoDX mod folder.
// Public entry points accept and return linear BT.709.
//
// Primary authoring resolves the gamut hull, white point, primary controls,
// matrices, and XYZ Y basis before shader execution. The CPU solver can emit
// either an exact working-basis/inverse pair or an AgX-like independent
// inset/outset formation pair. The shader consumes only the resolved data.

namespace renodx {
namespace tonemap {
namespace prism {

static const int CHROMA_SPACE_PRISM = 0;
static const int CHROMA_SPACE_MACLEOD_BOYNTON = 1;
static const int CONTRAST_FUNCTION_ANCHORED = 0;
static const int CONTRAST_FUNCTION_POW = 1;

float3x3 MatrixFromRows(float4 row0, float4 row1, float4 row2) {
  return float3x3(
      row0.x, row0.y, row0.z,
      row1.x, row1.y, row1.z,
      row2.x, row2.y, row2.z);
}

struct Config {
  // Display and tonal reference values.
  float3 tone_map_peak;
  float diffuse_white_nits;
  float3 anchor_in;
  float3 anchor_out;

  // Resolved formation data. In normal working-basis mode these matrices are
  // exact inverses. In AgX-like mode they are intentionally independent.
  float3x3 inset_matrix;
  float3x3 outset_matrix;

  // Precomputed by the CPU Prism solver or passed via helper function.
  float3 y_weights;
  float3 neutral_axis;
  float neutral_axis_y_rcp;
  float3x3 working_to_lms_matrix;
  float3x3 lms_to_working_matrix;

  // Tone-map shoulder configuration.
  float tone_map_compression_strength;
  int contrast_function;

  // Grading controls.
  float highlights;
  float shadows;
  float contrast;
  float saturation;
  float highlight_saturation;
  float dechroma;
  float flare;
  float highlight_contrast;
  float shadow_contrast;

  // Working-space selectors.
  int saturation_space;
  int highlight_saturation_space;
  int blowout_space;

  // Display gamut handling: 0 off, 1 compression, 2 RGB clip.
  // Matrices convert linear BT.709 and target RGB.
  int gamut_compression_enabled;
  float3x3 bt709_to_target;
  float3x3 target_to_bt709;
  float tone_map_white_clip;
};

namespace config {

// Construction path for CPU-resolved Prism primary data.
Config CreateResolved(
    float3 tone_map_peak,
    float diffuse_white_nits,
    float3 anchor_in,
    float3 anchor_out,
    float3x3 inset_matrix,
    float3x3 outset_matrix,
    float3 y_weights,
    float3 neutral_axis,
    float neutral_axis_y_rcp,
    float3x3 working_to_lms_matrix,
    float3x3 lms_to_working_matrix,
    float tone_map_compression_strength = 1.5f,
    int contrast_function = CONTRAST_FUNCTION_ANCHORED,
    float highlights = 1.f,
    float shadows = 1.f,
    float contrast = 1.f,
    float saturation = 1.f,
    float highlight_saturation = 1.f,
    float dechroma = 0.f,
    float flare = 0.f,
    float highlight_contrast = 1.f,
    float shadow_contrast = 1.f,
    int saturation_space = CHROMA_SPACE_MACLEOD_BOYNTON,
    int highlight_saturation_space = CHROMA_SPACE_MACLEOD_BOYNTON,
    int blowout_space = CHROMA_SPACE_MACLEOD_BOYNTON,
    float tone_map_white_clip = 100.f) {
  const Config config = {
      tone_map_peak,
      diffuse_white_nits,
      anchor_in,
      anchor_out,
      inset_matrix,
      outset_matrix,
      y_weights,
      neutral_axis,
      neutral_axis_y_rcp,
      working_to_lms_matrix,
      lms_to_working_matrix,
      tone_map_compression_strength,
      contrast_function,
      highlights,
      shadows,
      contrast,
      saturation,
      highlight_saturation,
      dechroma,
      flare,
      highlight_contrast,
      shadow_contrast,
      saturation_space,
      highlight_saturation_space,
      blowout_space,
      0,
      float3x3(1,0,0,0,1,0,0,0,1),
      float3x3(1,0,0,0,1,0,0,0,1),
      tone_map_white_clip
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

// Returns the point on the resolved Prism-space neutral axis with the
// requested XYZ Y. The CPU solver precomputes both the axis and its XYZ Y
// normalization for the selected authoring white.
float3 YNeutral(float y, Config config) {
  return config.neutral_axis
         * (y * config.neutral_axis_y_rcp);
}

// Scales the residual orthogonal to the XYZ Y functional.
// dot(result, y_weights) == dot(color, y_weights), apart from FP error.
float3 ApplyYChromaScale(float3 color, float chroma_scale, Config config) {
  const float y = XYZY(color, config);
  const float3 neutral = YNeutral(y, config);
  const float3 direction = color - neutral;
  // Preserve out-of-hull inputs; limit increases only from inside the hull.
  if (chroma_scale > 1.f && all(color >= 0.f.xxx) && all(neutral >= 0.f.xxx)) {
    float boundary = 1e30f;
    [unroll] for (int i = 0; i < 3; ++i) {
      if (direction[i] < 0.f) boundary = min(boundary, neutral[i] / -direction[i]);
    }
    if (boundary < 1e29f) {
      const float headroom = max(boundary - 1.f, 0.f);
      chroma_scale = 1.f + (headroom > 0.f ? renodx::tonemap::Neutwo(chroma_scale - 1.f, headroom) : 0.f);
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
    int contrast_function = CONTRAST_FUNCTION_ANCHORED) {
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

  return renodx::math::CopySign(contrasted_normalized * anchor_out, color);
}

float3 ApplyAnchoredPowContrast(
    float3 color,
    float3 anchor_in,
    float3 anchor_out,
    float contrast,
    float flare = 0.f) {
  float3 normalized = color / max(anchor_in, renodx::math::FLT_MIN);
  float3 magnitude = abs(normalized);
  float3 exponent = max(contrast, 0.f);
  if (flare > 0.f) {
    float3 shadow_distance = saturate(1.f - magnitude);
    float3 weight = exp2(-magnitude / max(shadow_distance, 1e-9f));
    exponent *= 1.f + weight * flare / (magnitude + flare);
  }
  return sign(normalized) * pow(max(magnitude, 1e-30f), exponent) * anchor_out;
}

// White-clip C-infinity rolloff from UE Extended. At the endpoints use
// explicit branches to avoid zero/infinity indeterminacies.
float ApplyAnchoredCInfinityShoulder(float color, float peak, float anchor, float compression_strength, float white_clip) {
  peak = max(peak, anchor + 1e-6f);
  const float clip = max(white_clip, peak + max(peak * 1e-6f, 1e-6f));
  if (color <= anchor) return color;
  if (color >= clip) return peak;
  const float shoulder_range = peak - anchor;
  const float clip_range = clip - anchor;
  const float distance = color - anchor;
  const float inverse_position = shoulder_range * (clip_range - distance) / ((clip - peak) * distance);
  const float weight = exp2(-inverse_position / max(compression_strength, 1.f));
  const float denominator = weight + inverse_position;
  const float transition = denominator > 0.f ? (distance / clip_range) * (weight / denominator) : 1.f;
  return mad(peak - clip, transition, color);
}
float3 ApplyAnchoredCInfinityShoulder(float3 color, float3 peak, float3 anchor, float compression_strength, float white_clip) {
  return float3(ApplyAnchoredCInfinityShoulder(color.x, peak.x, anchor.x, compression_strength, white_clip),
                ApplyAnchoredCInfinityShoulder(color.y, peak.y, anchor.y, compression_strength, white_clip),
                ApplyAnchoredCInfinityShoulder(color.z, peak.z, anchor.z, compression_strength, white_clip));
}

// Pre-tonal chroma grading ----------------------------------------------------
//
// Chroma shaping happens before contrast / flare / highlights /
// shadows. anchor_in is therefore the adaptation/purity pivot for this stage.
// anchor_out supplies the mapped tonal pivot and C-infinity shoulder anchor.
//
// The three controls can independently use either:
//   CHROMA_SPACE_PRISM              : live Prism-primary/XYZ Y neutral-axis scaling
//   CHROMA_SPACE_MACLEOD_BOYNTON    : adaptive Stockman-Sharpe LMS -> MB scaling
//
// The MB saturation path uses adaptive-relative purity.
// The MB blowout path uses separate per-cone bleaching availability.

float3 WorkingToLMS(float3 color, Config config) {
  return mul(config.working_to_lms_matrix, color);
}

float3 LMSToWorking(float3 lms, Config config) {
  return mul(config.lms_to_working_matrix, lms);
}

// Express the post-tonal peak in the pre-tonal anchor domain while preserving
// the configured peak / anchor_out ratio. This keeps blowout behavior stable
// when anchor_in and anchor_out differ.
float3 GetPreTonalPeak(Config config) {
  const float3 peak_over_output_anchor =
      renodx::math::DivideSafe(
          config.tone_map_peak,
          config.anchor_out,
          1.f.xxx);
  return config.anchor_in * peak_over_output_anchor;
}

float3 ToAdaptiveRelativeWeightedLMS(
    float3 lms_input,
    float3 adaptive_neutral_lms) {
  return renodx::math::DivideSafe(
      renodx::color::macleod_boynton::WeighLMS(lms_input),
      adaptive_neutral_lms,
      0.f.xxx);
}

float3 FromAdaptiveRelativeWeightedLMS(
    float3 lms_weighted_relative,
    float3 adaptive_neutral_lms) {
  return lms_weighted_relative * max(adaptive_neutral_lms, 1e-6f.xxx);
}

// Adaptive-relative MacLeod-Boynton purity scaling: normalize around the
// current adaptive LMS neutral, scale MB chromaticity away from its neutral,
// then restore the adaptive state and unweight LMS.
float3 ApplyMacLeodBoyntonPurity(
    float3 color,
    float purity_scale,
    Config config) {
  if (abs(purity_scale - 1.f) <= 1e-5f) return color;

  const float3 lms_input = WorkingToLMS(color, config);
  const float3 adaptive_neutral_lms =
      max(WorkingToLMS(config.anchor_in, config), 1e-6f.xxx);

  const float3 relative_weighted =
      ToAdaptiveRelativeWeightedLMS(
          lms_input,
          adaptive_neutral_lms);

  float3 mb =
      renodx::color::macleod_boynton::from::WeightedLMS(
          relative_weighted);

  const float3 mb_neutral =
      renodx::color::macleod_boynton::from::LMS(1.f.xxx);

  // Intersect the adaptive-relative MB ray with the working RGB hull. At
  // fixed L+M, working RGB is linear along the ray, even for a primary at infinity.
  if (purity_scale > 1.f && mb.z > renodx::color::gamut::EPSILON) {
    const float2 direction = mb.xy - mb_neutral.xy;
    if (dot(direction, direction) > renodx::color::gamut::MB_NEAR_WHITE_EPSILON) {
      const float3 origin = LMSToWorking(renodx::color::macleod_boynton::UnweighLMS(
          FromAdaptiveRelativeWeightedLMS(float3(mb_neutral.x, 1.f - mb_neutral.x, mb_neutral.y), adaptive_neutral_lms)), config);
      const float3 delta = LMSToWorking(renodx::color::macleod_boynton::UnweighLMS(
          FromAdaptiveRelativeWeightedLMS(float3(direction.x, -direction.x, direction.y), adaptive_neutral_lms)), config);
      if (all(origin >= -1e-6f.xxx)) {
        float boundary = 1e30f;
        [unroll] for (int i = 0; i < 3; ++i) {
          if (delta[i] < 0.f) boundary = min(boundary, max(origin[i], 0.f) / -delta[i]);
        }
        if (boundary < 1e29f) {
          const float headroom = max(boundary - 1.f, 0.f);
          purity_scale = 1.f + (headroom > 0.f ? renodx::tonemap::Neutwo(purity_scale - 1.f, headroom) : 0.f);
        }
      }
    }
  }
  mb.xy = lerp(mb_neutral.xy, mb.xy, purity_scale);

  const float3 relative_weighted_out =
      renodx::color::macleod_boynton::WeightedLMSFromMacleodBoynton(mb);

  const float3 lms_out =
      renodx::color::macleod_boynton::UnweighLMS(
          FromAdaptiveRelativeWeightedLMS(
              relative_weighted_out,
              adaptive_neutral_lms));

  return LMSToWorking(lms_out, config);
}

float3 ApplyChromaScale(
    float3 color,
    float chroma_scale,
    int chroma_space,
    Config config) {
  if (abs(chroma_scale - 1.f) <= 1e-5f) return color;

  [branch]
  if (chroma_space == CHROMA_SPACE_MACLEOD_BOYNTON) {
    return ApplyMacLeodBoyntonPurity(color, chroma_scale, config);
  }

  return ApplyYChromaScale(color, chroma_scale, config);
}

// Control Resonant's anchor-relative, 2.75-decade smootherstep response,
// evaluated on Prism's XYZ Y basis before any chroma adjustment.
float ComputePrismYHighlightRolloff(float3 color, Config config) {
  const float luminance = max(0.f, XYZY(color, config));
  const float anchor_luminance = max(XYZY(config.anchor_in, config), 0.000001f);
  const float relative_luminance = max(luminance / anchor_luminance, 1.f);
  const float position = saturate(log2(relative_luminance) / (2.75f * log2(10.f)));
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

// Prism-primary blowout retains peak-based per-cone bleaching. The updated
// luminance rolloff controls where that bleaching becomes active.
float3 ApplyPrismBlowout(float3 color, float highlight_rolloff, Config config) {
  if (config.dechroma == 0.f) return color;

  const float adaptive_y = max(XYZY(config.anchor_in, config), 0.000001f);
  const float peak_y = max(XYZY(GetPreTonalPeak(config), config), 0.000001f);
  const float full_bleach_availability = 1.f / (1.f + (peak_y / adaptive_y));
  const float blowout_strength = saturate(config.dechroma * highlight_rolloff);
  const float availability = lerp(1.f, full_bleach_availability, blowout_strength);
  return ApplyYChromaScale(color, availability, config);
}

// MacLeod-Boynton/LMS blowout: use per-cone bleaching availability and pull
// the cone response toward the adaptive neutral at equal total cone energy.
// Prism's gamut boundary handling remains in the purity operation/final pass.
float3 ApplyMacLeodBoyntonBlowout(float3 color, float highlight_rolloff, Config config) {
  if (config.dechroma == 0.f) return color;

  float3 lms = WorkingToLMS(color, config);
  const float3 adaptive_neutral_lms = max(WorkingToLMS(config.anchor_in, config), 1e-6f.xxx);
  const float3 peak_lms = max(WorkingToLMS(GetPreTonalPeak(config), config), 0.f.xxx);
  float3 availability = 1.f.xxx / (1.f.xxx + (peak_lms / adaptive_neutral_lms));
  const float blowout_strength = saturate(config.dechroma * highlight_rolloff);
  availability = lerp(1.f.xxx, availability, blowout_strength);

  const float input_energy = lms.x + lms.y + lms.z;
  const float white_energy = adaptive_neutral_lms.x + adaptive_neutral_lms.y + adaptive_neutral_lms.z;
  const float3 white_at_energy = adaptive_neutral_lms
      * renodx::math::DivideSafe(input_energy, white_energy, 0.f);
  const float3 delta = (lms - white_at_energy) * availability;
  return LMSToWorking(max(0.f.xxx, white_at_energy + delta), config);
}

float3 ApplyChromaGrading(float3 color, Config config) {
  // Compute one Prism XYZ Y rolloff from the untouched, sanitized signal.
  // Reuse it for highlight saturation and peak-based blowout strength.
  const float highlight_rolloff = ComputePrismYHighlightRolloff(color, config);
  const float highlight_scale = ComputeHighlightSaturationScale(highlight_rolloff, config);

  // 1) Global saturation / purity.
  color = ApplyChromaScale(
      color,
      config.saturation,
      config.saturation_space,
      config);

  // 2) Highlight saturation, using the shared anchored response curve and an
  // independently selectable, gamut-aware chroma basis.
  if (config.highlight_saturation != 1.f) {
    color = ApplyChromaScale(
        color,
        highlight_scale,
        config.highlight_saturation_space,
        config);
  }

  // 3) Blowout / bleaching.
  if (config.dechroma != 0.f) {
    [branch]
    if (config.blowout_space == CHROMA_SPACE_MACLEOD_BOYNTON) {
      color = ApplyMacLeodBoyntonBlowout(color, highlight_rolloff, config);
    } else {
      color = ApplyPrismBlowout(color, highlight_rolloff, config);
    }
  }

  return color;
}

// Equivalent Witcher softplus limiter, rearranged to avoid cancellation.
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

// Apply radial L8 demand against both faces of the target display gamut.
float3 CompressDisplayGamut(float3 working, float anchor, Config config) {
  float3 output709 = mul(config.outset_matrix, working);
  float3 target = mul(config.bt709_to_target, output709);
  const float peak = max(config.tone_map_peak.x, 1e-6f);
  anchor = clamp(anchor, 0.f, peak);
  const float3 delta = target - anchor.xxx;
  const float3 demand3 = max(max(-delta, 0.f.xxx) / max(anchor, 1e-8f),
                             max(delta, 0.f.xxx) / max(peak - anchor, 1e-8f));
  const float demand_scale = max(demand3.x, max(demand3.y, demand3.z));
  if (demand_scale > 0.f) {
    float3 n = demand3 / demand_scale;
    n *= n; n *= n;
    const float demand = demand_scale * sqrt(sqrt(sqrt(dot(n,n))));
    target = anchor.xxx + delta * (GamutSmoothUnitLimit(demand) / demand);
  }
  return mul(config.target_to_bt709, clamp(target, 0.f, peak));
}

// Match RenoDX's SanitizeGamutInput in Prism's inset basis. This only moves
// negative-Y values to the Y=0 boundary; it is not another gamut compressor.
float3 SanitizeInsetForGrading(float3 color, Config config) {
  float y = XYZY(color, config);
  if (y >= 0.f) return color;
  const float3 positive = max(color, 0.f.xxx);
  const float positive_y = XYZY(positive, config);
  const float scale = positive_y / (positive_y - y);
  return mad(color - positive, scale, positive);
}

// Applies pre-tonal chroma grading, tonal grading, and the asymptotic
// C-infinity shoulder to a color ALREADY in the configured formation basis.
float3 ApplyWithGamutAnchor(float3 color, Config config, out float gamut_anchor) {
  float neutral_input = max(XYZY(max(color, 0.f.xxx), config) * config.neutral_axis_y_rcp, 0.f);
  // Sanitize negative luminance in the actual inset basis before grading.
  if (config.gamut_compression_enabled == 1) color = SanitizeInsetForGrading(color, config);
  color = ApplyChromaGrading(color, config);
  // Chroma grading can reintroduce negative luminance.
  if (config.gamut_compression_enabled == 1 && XYZY(color, config) < 0.f) {
    color = SanitizeInsetForGrading(color, config);
  }

  float3 neutral_graded = ApplyAnchoredTonalGrading(neutral_input.xxx,
      config.anchor_in, config.anchor_out, config.contrast, config.flare,
      config.highlight_contrast, config.shadow_contrast, config.highlights,
      config.shadows, config.contrast_function);
  gamut_anchor = ApplyAnchoredCInfinityShoulder(neutral_graded.x,
      config.tone_map_peak.x, config.anchor_out.x,
      config.tone_map_compression_strength, config.tone_map_white_clip);

  color = ApplyAnchoredTonalGrading(
      color,
      config.anchor_in,
      config.anchor_out,
      config.contrast,
      config.flare,
      config.highlight_contrast,
      config.shadow_contrast,
      config.highlights,
      config.shadows,
      config.contrast_function);

  // Sanitize negative luminance after tonal grading, before the shoulder.
  if (config.gamut_compression_enabled == 1) color = SanitizeInsetForGrading(color, config);

  color = ApplyAnchoredCInfinityShoulder(
      color,
      config.tone_map_peak,
      config.anchor_out,
      config.tone_map_compression_strength,
      config.tone_map_white_clip);

  return color;
}

float3 Apply(float3 color, Config config) {
  float unused_anchor;
  return ApplyWithGamutAnchor(color, config, unused_anchor);
}

// Public BT.709 -> formation -> grade -> tone map -> output BT.709 path.
//
// Matrices follow RenoDX's convention:
//   formation = mul(inset_matrix, bt709);
//   bt709     = mul(outset_matrix, formation);
//
// In WORKING_BASIS mode outset_matrix is the exact inverse of inset_matrix.
// In AGX_INSET_OUTSET mode the two are independently authored formation
// transforms and are intentionally not required to cancel.
//
// Optional display-gamut compression is disabled by default.
float3 BT709(float3 bt709, Config config) {
  float3 color = mul(config.inset_matrix, bt709);
  float gamut_anchor;
  color = ApplyWithGamutAnchor(color, config, gamut_anchor);
  float3 output709 = mul(config.outset_matrix, color);
  if (config.gamut_compression_enabled == 1) {
    output709 = CompressDisplayGamut(color, gamut_anchor, config);
  } else if (config.gamut_compression_enabled == 2) {
    float3 target = mul(config.bt709_to_target, output709);
    output709 = mul(config.target_to_bt709, clamp(target, 0.f, max(config.tone_map_peak.x, 1e-6f)));
  }
  return renodx::math::ZeroNaN(output709);
}


// RenoDX cbuffer wiring example:
//
// const float3x3 prism_inset = MatrixFromRows(
//     shader_injection.prism_inset_0,
//     shader_injection.prism_inset_1,
//     shader_injection.prism_inset_2);
// const float3x3 prism_outset = MatrixFromRows(
//     shader_injection.prism_outset_0,
//     shader_injection.prism_outset_1,
//     shader_injection.prism_outset_2);
// const float3x3 prism_to_lms = MatrixFromRows(
//     shader_injection.prism_to_lms_0,
//     shader_injection.prism_to_lms_1,
//     shader_injection.prism_to_lms_2);
// const float3x3 lms_to_prism = MatrixFromRows(
//     shader_injection.prism_from_lms_0,
//     shader_injection.prism_from_lms_1,
//     shader_injection.prism_from_lms_2);
//
// Config prism_config = config::CreateResolved(
//     peak,
//     diffuse_white_nits,
//     anchor_in,
//     anchor_out,
//     prism_inset,
//     prism_outset,
//     shader_injection.prism_y_weights.xyz,
//     shader_injection.prism_neutral_axis.xyz,
//     shader_injection.prism_y_weights.w,
//     prism_to_lms,
//     lms_to_prism,
//     compression_strength,
//     contrast_function,
//     highlights,
//     shadows,
//     contrast,
//     saturation,
//     highlight_saturation,
//     blowout,
//     flare,
//     highlight_contrast,
//     shadow_contrast,
//     saturation_space,
//     highlight_saturation_space,
//     blowout_space);
//
// color = BT709(color, prism_config);

}  // namespace prism
}  // namespace tonemap
}  // namespace renodx

#endif  // RENODX_MOD_PRISM_HLSL_
