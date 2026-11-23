#include "../reference/prism_standalone.hlsl"

float4 main(float4 color : COLOR0) : SV_Target {
    prism::Config config =
      prism::config::CreateResolved(
          1.f);
  config.saturation = 1.2f;
  config.dechroma = 0.5f;
  return float4(prism::BT709(color.rgb, config), color.a);
}