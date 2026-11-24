/* Prism WebGL2 preview — CIE-resolved matrices and XYZ Y chroma controls. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const cnv = $('imageCanvas');
  const status = $('imageStatus');
  if (location.protocol === 'file:') {
    status.textContent = 'To open Prism locally, double-click Start Prism Web.bat in this folder. Keep its window open while using the app.';
    $('exrSelect').replaceChildren(new Option('Open using Start Prism Web.bat',''));
    return;
  }
  const gl = cnv.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
  if (!gl) { status.textContent = 'WebGL2 unavailable: enable hardware acceleration in your browser.'; $('exrSelect').replaceChildren(new Option('Preview unavailable — see error below','')); return; }

  const VERT = `#version 300 es
  precision highp float;
  out vec2 vUV;
  void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    vUV = vec2(p.x, 1.0 - p.y);
  }`;
  const FRAG = `#version 300 es
  precision highp float;
  precision highp int;
  in vec2 vUV;
  out vec4 outColor;
  uniform sampler2D uImage;
  uniform mat3 uSrc709, uInset, uOutset;
  uniform vec3 uYWeights, uNeutral;
  uniform float uNeutralInvY;
  uniform vec4 uGrade0; // saturation, highlight saturation, blowout, unused
  uniform vec4 uGrade1; // anchor in, anchor out, contrast, flare
  uniform vec4 uGrade2; // highlight contrast, shadow contrast, highlights, shadows
  uniform int uToneMapper;
  uniform highp sampler3D uReferenceLut;
  uniform mat3 uToEGamut;
  uniform float uHableWhite, uWhiteClip;
  uniform int uShoulderMode;
  uniform vec4 uPsychoA,uPsychoB;
  uniform vec2 uPsychoC;
  uniform ivec3 uPsychoMode;
  uniform int uOutputLinear;
  uniform vec3 uCurve;  // peak, compression, exposure multiplier
  uniform int uContrastMode, uGamutWarning, uPrismGamut;
  uniform mat3 uPrismTarget, uTargetTo709;
  uniform mat3 uGamutMatrix;
  uniform float uSplit;

  const float E = 1e-9;
  float xyzY(vec3 c) { return dot(c, uYWeights); }
  vec3 yNeutral(float y) { return uNeutral * (y * uNeutralInvY); }
  float infTransition(float x) {
    x = clamp(x, 0.0, 1.0);
    if (x <= 0.0) return 0.0;
    if (x >= 1.0) return 1.0;
    return 1.0 / (1.0 + exp2((1.0 - 2.0*x)/(x*(1.0-x))));
  }
  float tonalOne(float x) {
    float anchorIn = max(uGrade1.x, 0.000001);
    float anchorOut = max(uGrade1.y, 0.0);
    float contrast = uGrade1.z, flare = uGrade1.w;
    float hContrast = uGrade2.x, sContrast = uGrade2.y;
    float highlights = uGrade2.z, shadows = uGrade2.w;
    if (contrast == 1.0 && flare == 0.0 && hContrast == 1.0 && sContrast == 1.0
      && highlights == 1.0 && shadows == 1.0 && anchorIn == anchorOut) return x;
    float ax = abs(x);
    if (ax == 0.0) return 0.0;
    float normalized = max(ax / anchorIn, E);
    float contrasted = normalized;
    if (uContrastMode == 1) {
      float exponent = max(contrast,0.0);
      if (flare > 0.0) {
        float shadowDistance = clamp(1.0-normalized,0.0,1.0);
        float flatWeight = exp2(-normalized/max(shadowDistance,E));
        exponent *= 1.0 + flatWeight*flare/(normalized+flare);
      }
      contrasted = pow(normalized,exponent);
    } else if (contrast != 1.0 || flare > 0.0) {
      float exponent = contrast;
      if (flare > 0.0) {
        float shadowDistance = clamp(1.0-normalized,0.0,1.0);
        float flatWeight = exp2(-normalized/max(shadowDistance,E));
        exponent *= 1.0 + flatWeight*flare/(normalized+flare);
      }
      float inputStops = log2(normalized);
      float highStops = max(inputStops,0.0);
      float outHigh = highStops;
      if (contrast != 1.0) {
        float disp = (contrast-1.0)*highStops;
        float mag = abs(disp);
        outHigh += disp/(1.0+mag*exp2(-1.0/max(mag,E)));
      }
      contrasted = exp2(exponent*min(inputStops,0.0)+outHigh);
    }
    if (hContrast != 1.0) {
      float d = max(contrasted-1.0,0.0), d2=d*d;
      float flatFactor = (1.0+d2)*exp2(-1.0/max(d2,E));
      contrasted += d*(pow(1.0+flatFactor, 0.5*(hContrast-1.0))-1.0);
    }
    if (sContrast != 1.0) {
      float d = clamp(1.0-contrasted,0.0,1.0), d2=d*d;
      float flatFactor = d2*d*exp2(1.0-1.0/max(d2,E));
      contrasted *= pow(1.0+flatFactor,sContrast-1.0);
    }
    if (highlights != 1.0 || shadows != 1.0) {
      float stops = log2(max(contrasted,E));
      float disp = 0.0;
      if (highlights != 1.0) {
        float a=highlights-1.0;
        disp += a*(1.5*abs(a)+0.5)*infTransition((stops-1.0)/7.0);
      }
      if (shadows != 1.0) {
        float a=shadows-1.0;
        disp += a*(1.5*abs(a)+0.5)*infTransition((-1.0-stops)/7.0);
      }
      contrasted *= exp2(disp);
    }
    return sign(x) * contrasted * anchorOut;
  }
  float shoulderOne(float x) {
    float magnitude=abs(x);
    float anchor=uGrade1.y;
    float peak=max(uCurve.x,anchor+0.000001);
    float clip=max(uWhiteClip,peak+max(peak*0.000001,0.000001));
    if(magnitude<=anchor) return x;
    if(magnitude>=clip) return sign(x)*peak;
    float range=peak-anchor, clipRange=clip-anchor, distance=magnitude-anchor;
    if(uShoulderMode==1) {
      float t=distance/clipRange;
      float q=log(2.0)*(2.0*t-1.0)/(t*(1.0-t));
      float logWarp=log(distance/range)+max(q,0.0)+log(1.0+exp(-abs(q)));
      float logBase=max(logWarp,0.0)+log(1.0+exp(-abs(logWarp)));
      float reinhard=range*(1.0-exp(-logBase));
      float start=infTransition(distance/min(range/16.0,clipRange*0.25));
      return sign(x)*(anchor+mix(distance,reinhard,start));
    }
    float inversePosition=range*(clipRange-distance)/((clip-peak)*distance);
    float weight=exp2(-inversePosition/max(uCurve.y,1.0));
    float denom=weight+inversePosition;
    float transition=denom>0.0 ? (distance/clipRange)*(weight/denom) : 1.0;
    return sign(x)*(magnitude+(peak-clip)*transition);
  }
  vec3 zeroNaN(vec3 value) {
    return mix(value,vec3(0.0),isnan(value));
  }
  // Smooth unit limiter adapted from CompressLMSRadial.
  float gamutSmoothUnitLimit(float demand) {
    const float sharpness=16.0;
    const float zeroOffset=1.0-log2(1.0+exp2(sharpness))/sharpness;
    float nearZero=0.0;
    if(!(demand>=1e-3)) {
      float originSlope=1.0/(1.0+exp2(-sharpness));
      nearZero=demand*originSlope
        *(1.0-0.5*sharpness*log(2.0)*(1.0-originSlope)*demand)
        /(1.0-zeroOffset);
      if(demand<=1e-4) return nearZero;
    }
    float limited=1.0-log2(1.0+exp2(sharpness*(1.0-demand)))/sharpness;
    float mapped=(limited-zeroOffset)/(1.0-zeroOffset);
    if(demand>=1e-3) return mapped;
    float t=(demand-1e-4)/9e-4;
    float transition=1.0/(1.0+exp2((1.0-2.0*t)/(t*(1.0-t))));
    return mix(nearZero,mapped,transition);
  }
  vec3 compressPrismOutput(vec3 formation) {
    vec3 target=uPrismTarget*(uOutset*formation);
    float y=xyzY(formation);
    // Use the target's existing clip point as a luminance reference, not as
    // the output color. Ease into recovery when signed RGB cancels Y.
    vec3 visible=clamp(target,0.0,uCurve.x);
    float visibleY=max(xyzY(uInset*(uTargetTo709*visible)),0.0);
    // Magic numbers for saturated-color recovery (not a color-space standard):
    // 0.85 sets the recovery floor to 85% of the clipped target's XYZ Y,
    // not 85% of display peak. It replaced the darker 50% floor.
    // 0.15 sets the smooth join's half-width, also relative to visibleY.
    // It controls how gradually recovery kicks in and need not sum to 1
    // with the floor fraction.
    float floorY=0.85*visibleY;
    float width=0.15*visibleY;
    float recoveredY=max(y,floorY);
    if(width>0.0) {
      // Quadratic smooth max: joins both branches with matching slopes.
      float overlap=max(width-abs(y-floorY),0.0)/width;
      recoveredY+=0.25*width*overlap*overlap;
    }
    vec3 neutral=yNeutral(recoveredY);
    vec3 origin=uPrismTarget*(uOutset*neutral);
    if(any(lessThan(origin,vec3(0.0))) || any(greaterThan(origin,vec3(uCurve.x)))) return formation;
    vec3 ray=formation-neutral;
    vec3 delta=target-origin;
    float demand=0.0;
    for(int i=0;i<3;i++) {
      if(delta[i]==0.0) continue;
      float room=delta[i]<0.0 ? origin[i] : uCurve.x-origin[i];
      if(room==0.0) return neutral;
      // The cube boundary is the first face hit. Combining pressures with
      // an L8 norm rounds off edges and corners, dulling saturated primaries.
      demand=max(demand,abs(delta[i])/room);
    }
    if(demand==0.0) return formation;
    float scale=gamutSmoothUnitLimit(demand)/demand;
    return scale==1.0 ? formation : neutral+ray*scale;
  }
  float prismYHighlightRolloff(vec3 c) {
    float luminance=max(xyzY(c),0.0);
    float anchorY=max(xyzY(vec3(uGrade1.x)),E);
    // Start three quarters of a stop below the anchor; keep the full-strength point fixed.
    const float onsetOffset=0.75;
    float relativeY=max(luminance/anchorY,exp2(-onsetOffset));
    float position=clamp((log2(relativeY)+onsetOffset)/(2.75*log2(10.0)+onsetOffset),0.0,1.0);
    return position*position*position*(position*(position*6.0-15.0)+10.0);
  }
  float prismYHighlightSatScale(float rolloff) {
    float highlightRolloff=rolloff*rolloff*(0.5*rolloff+0.5);
    return 1.0+(uGrade0.y-1.0)*highlightRolloff*(2.0/3.0);
  }
  vec3 prismChromaAfter(vec3 rendered, float rolloff) {
    float strength=clamp(uGrade0.z*rolloff,0.0,1.0);
    float availability=mix(1.0,1.0/(1.0+uCurve.x/max(uGrade1.y,E)),strength);
    float amount=uGrade0.x*prismYHighlightSatScale(rolloff)*availability;
    if(abs(amount-1.0)<0.00001) return rendered;
    // Grade in formation RGB. Project the ray into the target only for the hull test.
    vec3 neutral=yNeutral(xyzY(rendered));
    vec3 direction=rendered-neutral;
    // Measure the ray against Prism's nonnegative RGB hull, not the display cube.
    if(amount>1.0 && all(greaterThanEqual(neutral,vec3(0.0)))) {
      float formationBoundary=1e30;
      for(int i=0;i<3;i++) {
        if(direction[i]<0.0) formationBoundary=min(formationBoundary,neutral[i]/-direction[i]);
      }
      if(formationBoundary<1e29) {
        // The boundary is in units of current chroma (the input is at t=1).
        // Compress only the requested increase; never pull an already-outside
        // color toward neutral just because saturation was increased.
        float headroom=max(formationBoundary-1.0,0.0), increase=amount-1.0;
        amount=1.0+(headroom>0.0 ? headroom*increase/length(vec2(increase,headroom)) : 0.0);
      }
    }
    // The output compressor needs the uncapped ray; clip modes use a hard cap.
    if(uPrismGamut==2) {
      vec3 origin=uPrismTarget*(uOutset*neutral), delta=uPrismTarget*(uOutset*direction);
      if(all(greaterThanEqual(origin,vec3(0.0))) && all(lessThanEqual(origin,vec3(uCurve.x)))) {
        float boundary=1e30;
        for(int i=0;i<3;i++) {
          if(delta[i]<0.0) boundary=min(boundary,origin[i]/-delta[i]);
          else if(delta[i]>0.0) boundary=min(boundary,(uCurve.x-origin[i])/delta[i]);
        }
        amount=min(amount,boundary);
      }
    }
    return neutral+direction*amount;
  }
  vec3 prismMap(vec3 input709) {
    vec3 c=uInset*input709;
    float rolloff=prismYHighlightRolloff(c);
    c=vec3(tonalOne(c.r),tonalOne(c.g),tonalOne(c.b));
    c=vec3(shoulderOne(c.r),shoulderOne(c.g),shoulderOne(c.b));
    // Match RenoDX math::ZeroNaN: clear NaNs per channel after the outset.
    c=prismChromaAfter(c,rolloff);
    if(uPrismGamut==1) c=compressPrismOutput(c);
    vec3 output709=uOutset*c;
    if(uPrismGamut>=1) {
      float peak=max(uCurve.x,0.000001);
      vec3 target=uPrismTarget*output709;
      output709=uTargetTo709*clamp(target,0.0,peak);
    }
    return zeroNaN(output709);
  }
  ${PSYCHO35_GLSL}
  vec3 tetraLut(vec3 coord) {
    ivec3 size=textureSize(uReferenceLut,0); vec3 p=clamp(coord,0.0,1.0)*vec3(size-1);
    ivec3 lo=min(ivec3(floor(p)),size-ivec3(2)); vec3 f=p-vec3(lo);
    vec3 c=texelFetch(uReferenceLut,lo,0).rgb;
    ivec3 e1,e2;
    if(f.x>=f.y) { if(f.y>=f.z){e1=ivec3(1,0,0);e2=ivec3(1,1,0);} else if(f.x>=f.z){e1=ivec3(1,0,0);e2=ivec3(1,0,1);} else {e1=ivec3(0,0,1);e2=ivec3(1,0,1);} }
    else { if(f.x>=f.z){e1=ivec3(0,1,0);e2=ivec3(1,1,0);} else if(f.y>=f.z){e1=ivec3(0,1,0);e2=ivec3(0,1,1);} else {e1=ivec3(0,0,1);e2=ivec3(0,1,1);} }
    float f1=dot(vec3(e1),f); float f2=dot(vec3(e2-e1),f); float f3=dot(vec3(ivec3(1)-e2),f);
    vec3 a=texelFetch(uReferenceLut,lo+e1,0).rgb, b=texelFetch(uReferenceLut,lo+e2,0).rgb,d=texelFetch(uReferenceLut,lo+ivec3(1),0).rgb;
    return c+(a-c)*f1+(b-a)*f2+(d-b)*f3;
  }
  float hableOne(float x) { float A=.15,B=.50,C=.10,D=.20,E1=.02,F=.30; return ((x*(A*x+C*B)+D*E1)/(x*(A*x+B)+D*F))-E1/F; }
  vec3 toneMapOther(vec3 c) {
    if(uToneMapper==1) {
      vec3 x=2.0*max(c,vec3(0.0));
      return uCurve.x*vec3(hableOne(x.r),hableOne(x.g),hableOne(x.b))/hableOne(uHableWhite);
    }
    if(uToneMapper==2) { float y=dot(c,vec3(.2126390059,.7151686788,.0721923154)); return y>0.0 ? c*(uCurve.x/(1.0+y)) : vec3(0.0); }
    if(uToneMapper==5) return zeroNaN(psycho35(c));
    if(uToneMapper==3) {
      // Signed asinh allocation, paired with tools/bake_aces13.py.
      const float limit=4096.0, softness=0.01, edge=limit/softness;
      vec3 x=min(abs(c),vec3(limit))/softness;
      vec3 shaped=sign(c)*log(x+sqrt(x*x+1.0))/log(edge+sqrt(edge*edge+1.0));
      return tetraLut(0.5+0.5*shaped);
    }
    vec3 q=uToEGamut*c;
    q=clamp((log2(max(q,vec3(exp2(-12.47393))))+12.47393)/25.0,0.0,1.0);
    vec3 v=tetraLut(q);
    return pow(max(v,vec3(0.0)),vec3(2.4));
  }
  vec3 encodeSRGB(vec3 c) {
    c=max(c,vec3(0.0));
    return mix(1.055*pow(c,vec3(1.0/2.4))-0.055,12.92*c,lessThanEqual(c,vec3(0.0031308)));
  }
  void main() {
    vec3 encoded=texture(uImage,vUV).rgb; // raw scene-linear RGB, from EXR
    vec3 src=uSrc709*encoded*uCurve.z; // source working gamut -> BT.709 + exposure
    vec3 raw=src;
    vec3 formed=uToneMapper==0 ? prismMap(src) : toneMapOther(src);
    vec3 chosen=vUV.x < uSplit ? raw : formed;
    vec3 target=uGamutMatrix*chosen;
    bool outOfGamut=uGamutWarning==1 && (any(lessThan(target,vec3(-0.00001))) || any(greaterThan(target,vec3(uCurve.x+0.00001))));
    outColor=uOutputLinear == 1 ? vec4(chosen,1.0) : vec4(clamp(encodeSRGB(chosen),vec3(0.0),vec3(1.0)),1.0);
    if(outOfGamut) outColor.rgb=uOutputLinear == 1 ? vec3(1.0,0.01764,0.0835) : vec3(1.0,0.14,0.32);
    if (uSplit>0.0 && uSplit<1.0 && abs(vUV.x-uSplit)<0.0015) outColor.rgb=uOutputLinear == 1 ? vec3(1.0,0.6383,0.05925) : vec3(1.0,0.82,0.27);
  }`;

  function makeShader(type, src) {
    const obj=gl.createShader(type); gl.shaderSource(obj,src); gl.compileShader(obj);
    if (!gl.getShaderParameter(obj,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(obj));
    return obj;
  }
  let program, texture, u={};
  try {
    const v=makeShader(gl.VERTEX_SHADER,VERT), f=makeShader(gl.FRAGMENT_SHADER,FRAG);
    program=gl.createProgram(); gl.attachShader(program,v); gl.attachShader(program,f); gl.linkProgram(program);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.deleteShader(v); gl.deleteShader(f); gl.useProgram(program);
    for (const name of ['uToneMapper','uReferenceLut','uToEGamut','uHableWhite','uWhiteClip','uShoulderMode','uPsychoA','uPsychoB','uPsychoC','uPsychoMode','uOutputLinear','uImage','uSrc709','uInset','uOutset','uYWeights','uNeutral','uNeutralInvY','uContrastMode','uGrade0','uGrade1','uGrade2','uCurve','uGamutWarning','uGamutMatrix','uPrismGamut','uPrismTarget','uTargetTo709','uSplit']) u[name]=gl.getUniformLocation(program,name);
    texture=gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texture);
    const floatFilter=gl.getExtension('OES_texture_float_linear')?gl.LINEAR:gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,floatFilter);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,floatFilter);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.uniform1i(u.uImage,0);
    gl.uniform1i(u.uReferenceLut,1);
    gl.bindVertexArray(gl.createVertexArray());
  } catch (e) { status.textContent='Shader compilation error: '+e.message; $('exrSelect').replaceChildren(new Option('Preview unavailable — see error below','')); console.error(e); return; }

  const P_AP0={r:[.7347,.2653],g:[0,1],b:[.0001,-.077],w:[.32168,.33767]};
  const P_AP1={r:[.713,.293],g:[.165,.830],b:[.128,.044],w:[.32168,.33767]};
  const P_ADOBE={r:[.64,.33],g:[.21,.71],b:[.15,.06],w:P709.w};
  // Adapt the source white to BT.709 D65 before the Prism working transform.
  function bradfordAdapt(from,to) {
    const B=[.8951,.2664,-.1614,-.7502,1.7135,.0367,.0389,-.0685,1.0296];
    const iB=inv3(B), src=m3v(B,xyToXYZ(...from)), dst=m3v(B,xyToXYZ(...to));
    const D=[dst[0]/src[0],0,0,0,dst[1]/src[1],0,0,0,dst[2]/src[2]];
    return m3mul(m3mul(iB,D),B);
  }
  const sourcePrimaries={ap0:P_AP0,acescg:P_AP1,bt709:P709,bt2020:P2020,p3:PP3,adobe:P_ADOBE};
  const sourceNames={ap0:'ACES2065-1 / AP0 (D60)',acescg:'ACEScg / AP1 (D60)',bt709:'linear BT.709 / sRGB',bt2020:'linear BT.2020',p3:'linear Display P3 (D65)',adobe:'linear Adobe RGB (D65)',xyz:'linear CIE XYZ (D65)'};
  const interopSpaces={lin_ap0_scene:'ap0',lin_ap1_scene:'acescg',lin_rec709_scene:'bt709',lin_rec2020_scene:'bt2020',lin_p3d65_scene:'p3',lin_adobergb_scene:'adobe',lin_ciexyzd65_scene:'xyz'};
  function validWhite(w){return Array.isArray(w)&&w.length===2&&w.every(Number.isFinite)&&w[0]>=0&&w[1]>1e-8&&w[0]+w[1]<1.001}
  function sourceMatrix(p,adoptedWhite){
    const all=[...p.r,...p.g,...p.b,...p.w];
    if(!all.every(Number.isFinite)||!validWhite(p.w)||[p.r,p.g,p.b].some(v=>Math.abs(v[1])<1e-8||v.some(x=>Math.abs(x)>10)))throw Error('Invalid EXR chromaticities');
    const white=adoptedWhite||p.w;
    const adapt=Math.max(Math.abs(white[0]-P709.w[0]),Math.abs(white[1]-P709.w[1]))<1e-8?[1,0,0,0,1,0,0,0,1]:bradfordAdapt(white,P709.w);
    const matrix=m3mul(MXYZ709,m3mul(adapt,rgb2xyz(p,p.w)));
    if(!matrix.every(Number.isFinite)||Math.abs(det3(matrix))<1e-12)throw Error('Invalid EXR color transform');
    return matrix;
  }
  const srcConversions=Object.fromEntries(Object.entries(sourcePrimaries).map(([key,p])=>[key,sourceMatrix(p)]));
  srcConversions.xyz=MXYZ709;
  function metadataPrimaries(values){
    if(!Array.isArray(values)||values.length!==8||!values.every(Number.isFinite))return null;
    return {r:values.slice(0,2),g:values.slice(2,4),b:values.slice(4,6),w:values.slice(6,8)};
  }
  function matchesPrimaries(a,b){return ['r','g','b','w'].every(k=>a[k].every((v,i)=>Math.abs(v-b[k][i])<0.0005))}
  function autoSourceFor(metadata,filename){
    if(!metadata)return {matrix:srcConversions.ap0,label:sourceNames.ap0,reason:'server supplied no color metadata',warning:'Restart the updated Prism server to enable metadata detection.'};
    const id=typeof metadata.colorInteropID==='string'?metadata.colorInteropID.trim().toLowerCase():'';
    const tagged=metadataPrimaries(metadata.chromaticities);
    const adopted=validWhite(metadata.adoptedNeutral)?metadata.adoptedNeutral:null;
    const adoptedWarning=(metadata.adoptedNeutralInvalid || (metadata.adoptedNeutral&&!adopted))?'Invalid adopted neutral ignored.':'';
    const namedSource=(name,reason,warning='')=>{
      try{return {matrix:adopted?sourceMatrix(sourcePrimaries[name],adopted):srcConversions[name],label:sourceNames[name],reason:reason+(adopted?' and adopted neutral':''),warning:warning||adoptedWarning}}
      catch(e){return {matrix:srcConversions[name],label:sourceNames[name],reason,warning:'Invalid adopted neutral ignored; verify the source.'}}
    };
    const fallback=(reason,warning='')=>namedSource('ap0',reason,warning);
    if(id && id!=='unknown'){
      const named=interopSpaces[id];
      if(!named)return fallback(`unsupported colorInteropID ${id}`,`Unsupported color encoding ${id}; convert the EXR to a supported linear space before previewing.`);
      try {
        const matrix=named==='xyz'?(adopted?m3mul(MXYZ709,bradfordAdapt(adopted,P709.w)):srcConversions.xyz):sourceMatrix(sourcePrimaries[named],adopted);
        const conflict=tagged && named!=='xyz' && !matchesPrimaries(tagged,sourcePrimaries[named]);
        return {matrix,label:sourceNames[named],reason:`EXR colorInteropID ${id}${adopted?' and adopted neutral':''}`,warning:conflict?'ColorInteropID and chromaticities disagree; verify the source.':adoptedWarning};
      } catch(e){return fallback('invalid color metadata',e.message+'; verify the source.');}
    }
    if(tagged){
      try {
        const named=Object.keys(sourcePrimaries).find(k=>matchesPrimaries(tagged,sourcePrimaries[k]));
        return {matrix:sourceMatrix(tagged,adopted),label:named?sourceNames[named]:'custom RGB primaries',reason:`EXR chromaticities${adopted?' and adopted neutral':''}`,warning:id==='unknown'?'The file marks its color space as unknown; verify the chromaticities.':adoptedWarning};
      } catch(e){return fallback('invalid EXR chromaticities',e.message+'; verify the source.');}
    }
    if(metadata.chromaticitiesInvalid || metadata.chromaticities)return fallback('invalid EXR chromaticities','The EXR color metadata is invalid; verify the source.');
    if(metadata.acesImageContainerFlag===1)return namedSource('ap0','EXR ACES container flag');
    const leaf=filename.split('/').pop();
    if(/(^|[._\s-])(acescg|ap1)(?=[._\s-]|$)/i.test(leaf))return namedSource('acescg','filename hint; EXR has no chromaticities','Filename hints may be wrong; verify the source.');
    if(/(^|[._\s-])(ap0|aces2065-1)(?=[._\s-]|$)/i.test(leaf))return namedSource('ap0','filename hint; EXR has no chromaticities','Filename hints may be wrong; verify the source.');
    return fallback('no usable EXR color metadata; AP0 fallback',id==='unknown'?'The file marks its color space as unknown; verify the source.':'No embedded source color space; verify the AP0 assumption.');
  }
  let autoSource=null, loadedSourceName='';
  function updateSourceStatus(){
    const el=$('sourceStatus'), selected=$('sourceGamut').value;
    if(!loadedSourceName){el.textContent=selected==='auto'?'Auto: waiting for EXR color metadata.':`Manual: ${sourceNames[selected]} — waiting for an image.`;el.className='muted';return}
    const info=autoSource;
    const manualWarning=info && info.warning.startsWith('Unsupported color encoding')?' '+info.warning:'';
    el.textContent=selected==='auto'?`Auto: ${info.label} — ${info.reason}. ${info.warning} EXR values are treated as scene-linear.`:`Manual: ${sourceNames[selected]}. EXR values are treated as scene-linear.${manualWarning}`;
    el.className=(selected==='auto'&&info.warning)||manualWarning?'warn':'muted';
  }
  const mat=(m)=>new Float32Array([m[0],m[3],m[6],m[1],m[4],m[7],m[2],m[5],m[8]]);
  let hdr=null, hdrRequest=0;
  const hdrCanvas=$('hdrCanvas');
  const hdrStatus=$('hdrStatus');
  function releaseHDR() {
    if (!hdr) return;
    if (hdr.glTexture) gl.deleteTexture(hdr.glTexture);
    if (hdr.fbo) gl.deleteFramebuffer(hdr.fbo);
    if (hdr.source) hdr.source.destroy();
    hdr.context.unconfigure();
    hdr.device.destroy();
    hdr=null;
  }
  function sdrFallback(message) {
    ++hdrRequest;releaseHDR(); $('outputMode').value='sdr';
    cnv.hidden=false; hdrCanvas.hidden=true;
    $('sdrPeakControl').hidden=true; $('hdrPeakControl').hidden=true;
    hdrStatus.textContent=message; hdrStatus.className='warn'; updateAll();
  }
  async function selectOutput() {
    const request=++hdrRequest;
    if ($('outputMode').value==='sdr') {
      releaseHDR(); cnv.hidden=false; hdrCanvas.hidden=true;
      $('sdrPeakControl').hidden=true; $('hdrPeakControl').hidden=true;
      hdrStatus.textContent='SDR output active.'; hdrStatus.className='muted'; updateAll(); return;
    }
    $('sdrPeakControl').hidden=true;
    hdrStatus.textContent='Checking HDR display and browser support…'; hdrStatus.className='muted'; updateAll();
    let device;
    try {
      if (!window.matchMedia('(dynamic-range: high)').matches) throw Error('The browser does not report an HDR-capable display. Enable HDR in your operating system and use an HDR display.');
      if (!navigator.gpu) throw Error('This browser does not provide WebGPU.');
      if (!gl.getExtension('EXT_color_buffer_float')) throw Error('Floating-point WebGL rendering is unavailable.');
      const adapter=await navigator.gpu.requestAdapter();
      if (!adapter) throw Error('No WebGPU adapter is available.');
      device=await adapter.requestDevice();
      if (request!==hdrRequest) { device.destroy(); return; }
      const context=hdrCanvas.getContext('webgpu');
      if (!context) throw Error('An HDR WebGPU canvas could not be created.');
      context.configure({device,format:'rgba16float',colorSpace:'srgb',toneMapping:{mode:'extended'},alphaMode:'opaque'});
      if (!context.getConfiguration || context.getConfiguration().toneMapping?.mode!=='extended') throw Error('The browser cannot confirm extended-range canvas output.');
      const module=device.createShaderModule({code:`
        struct Params { scale: f32 };
        @group(0) @binding(0) var image: texture_2d<f32>;
        @group(0) @binding(1) var<uniform> params: Params;
        @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
          var p=array<vec2f,3>(vec2f(-1.,-1.),vec2f(3.,-1.),vec2f(-1.,3.)); return vec4f(p[i],0.,1.);
        }
        @fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f {
          let size=textureDimensions(image);
          let rgb=textureLoad(image,vec2i(i32(p.x),i32(size.y)-1-i32(p.y)),0).rgb*params.scale;
          let a=abs(rgb);
          let result=sign(rgb)*select(12.92*a,1.055*pow(a,vec3f(1.0/2.4))-0.055,a>vec3f(0.0031308));
          return vec4f(result,1.);
        }`});
      const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
      device.pushErrorScope('validation');
      const pipeline=await device.createRenderPipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
      const validation=await device.popErrorScope(); if (validation) throw Error(validation.message);
      if (request!==hdrRequest) { context.unconfigure(); device.destroy(); return; }
      const params=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      hdr={device,context,layout,pipeline,params,width:0,height:0};
      device.lost.then(info=>{if(hdr && hdr.device===device) sdrFallback('HDR output stopped: '+info.message+' SDR output restored.');});
      cnv.hidden=true; hdrCanvas.hidden=false; hdrStatus.className='good';
      hdrStatus.textContent='HDR extended-range output active · nominal SDR white is 1.0; actual luminance depends on the system and display.';
      updateAll();
    } catch(e) {
      if (device) device.destroy();
      if (request===hdrRequest) sdrFallback('HDR unavailable: '+e.message+' SDR output restored.');
    }
  }
  function renderHDR() {
    const h=hdr, w=cnv.width, height=cnv.height;
    if (h.width!==w || h.height!==height) {
      if (h.glTexture) gl.deleteTexture(h.glTexture);
      if (h.fbo) gl.deleteFramebuffer(h.fbo);
      if (h.source) h.source.destroy();
      h.width=w; h.height=height; hdrCanvas.width=w; hdrCanvas.height=height;
      h.pitch=Math.ceil(w*16/256)*256;
      h.pixels=new Float32Array(h.pitch/4*height);
      h.glTexture=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,h.glTexture);
      gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32F,w,height);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      h.fbo=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,h.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,h.glTexture,0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw Error('Float framebuffer is incomplete.');
      gl.bindTexture(gl.TEXTURE_2D,texture);
      h.source=h.device.createTexture({size:[w,height],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
      h.bind=h.device.createBindGroup({layout:h.layout,entries:[{binding:0,resource:h.source.createView()},{binding:1,resource:{buffer:h.params}}]});
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,h.fbo); gl.uniform1i(u.uOutputLinear,1); gl.drawArrays(gl.TRIANGLES,0,3);
    gl.pixelStorei(gl.PACK_ROW_LENGTH,h.pitch/16);
    gl.readPixels(0,0,w,height,gl.RGBA,gl.FLOAT,h.pixels);
    gl.pixelStorei(gl.PACK_ROW_LENGTH,0); gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    h.device.queue.writeTexture({texture:h.source},h.pixels,{bytesPerRow:h.pitch,rowsPerImage:height},[w,height]);
    h.device.queue.writeBuffer(h.params,0,new Float32Array([1,0,0,0]));
    const encoder=h.device.createCommandEncoder();
    const pass=encoder.beginRenderPass({colorAttachments:[{view:h.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
    pass.setPipeline(h.pipeline); pass.setBindGroup(0,h.bind); pass.draw(3); pass.end(); h.device.queue.submit([encoder.finish()]);
  }
  $('outputMode').addEventListener('change',selectOutput);
  const referenceLuts={}, loadingLuts={};
  async function loadReferenceLut(name) {
    if(loadingLuts[name])return; loadingLuts[name]=true;
    try { const size=name==='agx.bin'?57:97;
      const response=await fetch(name);if(!response.ok)throw Error('HTTP '+response.status);
      const bytes=await response.arrayBuffer();if(bytes.byteLength!==size**3*16)throw Error('Invalid transform data');
      const lut=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_3D,lut);
      gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_R,gl.CLAMP_TO_EDGE);
      gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA32F,size,size,size,0,gl.RGBA,gl.FLOAT,new Float32Array(bytes));gl.activeTexture(gl.TEXTURE0);
      referenceLuts[name]=lut;window.updatePrismPreview();
    } catch(e){status.textContent='Failed to load reference transform: '+e.message;console.error(e);} finally {delete loadingLuts[name];}
  }
  let loaded=false;
  let scheduled=false;
  function render() {
    scheduled=false;
    if (!loaded) return;
    try {
      const prism=buildPrism();
      validConfig(prism);
      const inset=prism.inset;
      const outset=prism.outset;
      const weights=prism.yWeights;
      const neutral=prism.neutral;
      const neutralInv=prism.neutralInv;
      const g=controlsGrade(), exp=Math.pow(2,Number($('exposure').value)||0);
      const tone=Number($('toneMapper').value);
      const aOut=tone===0?Math.max(Number($('anchorOut').value),.000001):tone===5?Math.max(Number($('psyAnchorOut').value),.000001):.000001;
      const peak=Math.max(previewPeak(),aOut+.000001);
      gl.useProgram(program);
      const lutName=tone===3?($('acesRgc').value==='off'?'aces13-signed-no-rgc.bin':'aces13-signed.bin'):tone===4?'agx.bin':null;
      if (lutName && !referenceLuts[lutName]) { loadReferenceLut(lutName); return; }
      gl.uniform1f(u.uWhiteClip,Math.max(.001,Number($('whiteClip').value)||100));
      gl.uniform1i(u.uShoulderMode,Number($('shoulderMode').value));
      gl.uniform1i(u.uToneMapper,tone); gl.uniform1f(u.uHableWhite,Math.max(.01,Number($('hableWhite').value)||11.2));
      gl.uniform4f(u.uPsychoA,...['psyHighlights','psyShadows','psyContrast','psyPurity'].map(id=>Number($(id).value)));
      gl.uniform4f(u.uPsychoB,Number($('psyCompression').value),Number($('psyAnchorIn').value),Number($('psyAnchorOut').value),Number($('psyFitPower').value));
      gl.uniform2f(u.uPsychoC,Number($('psyConeExponent').value),Number($('psyGamutAmount').value));
      gl.uniform3i(u.uPsychoMode,Number($('psyTarget').value),Number($('psyFit').value),Number($('psyConditioning').value));
      gl.uniformMatrix3fv(u.uToEGamut,false,mat(m3mul(inv3(rgb2xyz({r:[.8,.3177],g:[.18,.9],b:[.065,-.0805]},P709.w)),M709XYZ)));
      if(lutName) {gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_3D,referenceLuts[lutName]);gl.uniform1i(u.uReferenceLut,1);gl.activeTexture(gl.TEXTURE0);}
      const sourceChoice=$('sourceGamut').value;
      gl.uniformMatrix3fv(u.uSrc709,false,mat(sourceChoice==='auto'?autoSource.matrix:srcConversions[sourceChoice]));
      gl.uniformMatrix3fv(u.uInset,false,mat(inset));
      gl.uniformMatrix3fv(u.uOutset,false,mat(outset));
      gl.uniform1i(u.uContrastMode,$('contrastMode').value==='pow'?1:0);
      gl.uniform3fv(u.uYWeights,new Float32Array(weights));
      gl.uniform3fv(u.uNeutral,new Float32Array(neutral));
      gl.uniform1f(u.uNeutralInvY,neutralInv);
      gl.uniform4f(u.uGrade0,g.saturation,g.highlightSat,g.dechroma,0);
      gl.uniform4f(u.uGrade1,g.anchorIn,g.anchorOut,g.contrast,g.flare);
      gl.uniform4f(u.uGrade2,g.highlightContrast,g.shadowContrast,g.highlights,g.shadows);
      gl.uniform3f(u.uCurve,peak,Math.max(1,Number($('compression').value)||1),exp);
      const prismGamut=$('prismGamut').value;
      const parts=prismGamut.split('-'),prefix=parts.length>1?parts[0]:'',gamutTarget=parts.length>1?parts[1]:prismGamut;
      gl.uniform1i(u.uPrismGamut,prismGamut==='off'?0:prefix==='output'?2:1);
      gl.uniformMatrix3fv(u.uPrismTarget,false,mat(gamutTarget==='off'?I3:inv3(srcConversions[gamutTarget])));
      gl.uniformMatrix3fv(u.uTargetTo709,false,mat(gamutTarget==='off'?I3:srcConversions[gamutTarget]));
      const warningGamut=$('gamutWarning').value;
      gl.uniform1i(u.uGamutWarning,warningGamut==='off'?0:1);
      gl.uniformMatrix3fv(u.uGamutMatrix,false,mat(warningGamut==='off'?I3:inv3(srcConversions[warningGamut])));
      gl.uniform1f(u.uSplit,Number($('splitPosition').value));
      gl.viewport(0,0,cnv.width,cnv.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      gl.uniform1i(u.uOutputLinear,0);
      gl.drawArrays(gl.TRIANGLES,0,3);
      if (hdr) {
        const target=previewPeak();
        const tooLow=(tone===0||tone===5)&&target<=aOut;
        hdrStatus.textContent=tooLow?'HDR peak is at or below the grading anchor; the effective shoulder peak has been raised above the anchor.':'HDR extended-range output active · nominal SDR white is 1.0; actual luminance depends on the system and display.';
        hdrStatus.className=tooLow?'warn':'good';
        renderHDR();
      }
    } catch(e) { if(hdr) sdrFallback('HDR output failed: '+e.message+' SDR output restored.'); else status.textContent='Preview update error: '+e.message; console.error(e); }
  }
  window.updatePrismPreview=()=>{ if (!scheduled) { scheduled=true; requestAnimationFrame(render); } };

  const builtins=[
    {name:'BT.709 primary flight gradient',url:'images/Prism_Primary_Flight_Gradient_BT709.exr'},
    {name:'DCI-P3 primary flight gradient',url:'images/Prism_Primary_Flight_Gradient_DCI_P3.exr'},
    {name:'BT.2020 primary flight gradient',url:'images/Prism_Primary_Flight_Gradient_BT2020.exr'}
  ];
  let localImages=[],imageEntries=[],latestRequest=0,decodeWorker=null;
  async function refresh(preferred) {
    const select=$('exrSelect'),previous=preferred ?? (select.dataset.loaded==='true'?select.value:window.prismSavedImage);
    imageEntries=[...builtins,...localImages];
    select.replaceChildren(...imageEntries.map((entry,i)=>new Option(entry.name,String(i))));
    select.dataset.loaded='true';
    select.value=(previous!==undefined && imageEntries[Number(previous)])?previous:'0';
    $('previousEXR').disabled=imageEntries.length<2;$('nextEXR').disabled=imageEntries.length<2;
    await loadEXR();
  }
  async function loadEXR() {
    const entry=imageEntries[Number($('exrSelect').value)]; if(!entry)return;
    const requestId=++latestRequest;if(decodeWorker)decodeWorker.terminate();
    status.textContent='Loading EXR…';
    try {
      let file=entry.file;if(!file){const response=await fetch(entry.url);if(!response.ok)throw Error('Could not load sample image (HTTP '+response.status+')');file=new File([await response.blob()],entry.name+'.exr');}
      if(requestId!==latestRequest)return;
      decodeWorker=new Worker(new URL('exr-worker.js',location.href),{type:'module'});
      const worker=decodeWorker;
      const result=await new Promise((resolve,reject)=>{worker.onmessage=e=>e.data.error?reject(Error(e.data.error)):resolve(e.data);worker.onerror=e=>reject(Error(e.message||'EXR decoder could not start'));worker.postMessage({id:requestId,file,maxSize:gl.getParameter(gl.MAX_TEXTURE_SIZE)});});
      if(requestId!==latestRequest)return;worker.terminate();decodeWorker=null;
      const {width,height,pixels,metadata}=result;gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,pixels);
      autoSource=autoSourceFor(metadata,entry.name);loadedSourceName=entry.name;updateSourceStatus();
      const scale=Math.min(1,1800/width,1100/height);cnv.width=Math.max(1,Math.round(width*scale));cnv.height=Math.max(1,Math.round(height*scale));
      $('imageFrame').style.setProperty('--image-width-limit',`${75*width/height}vh`);loaded=true;
      status.textContent=(width!==result.originalWidth||height!==result.originalHeight)?'Preview reduced to '+width+' × '+height+'.':'';window.updatePrismPreview();
    } catch(e) {if(requestId===latestRequest){if(decodeWorker)decodeWorker.terminate();decodeWorker=null;status.textContent='Failed to load EXR: '+e.message;console.error(e);}}
  }
  function addLocalFiles(fileList) {
    const files=Array.from(fileList).filter(f=>/\.exr$/i.test(f.name));
    if(!files.length){status.textContent='No EXR files were selected.';return;}
    localImages=files.map(file=>({name:file.webkitRelativePath||file.name,file})).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
    refresh(String(builtins.length));
  }
  $('chooseFiles').addEventListener('click',()=>$('localFiles').click());
  $('chooseFolder').addEventListener('click',()=>$('localFolder').click());
  for(const id of ['localFiles','localFolder'])$(id).addEventListener('change',event=>{addLocalFiles(event.target.files);event.target.value=''});
  function stepImage(direction) {
    const select=$('exrSelect');
    if (select.dataset.loaded!=='true' || select.disabled || select.options.length<2) return;
    select.selectedIndex=(select.selectedIndex+direction+select.options.length)%select.options.length;
    select.dispatchEvent(new Event('change',{bubbles:true}));
  }
  $('previousEXR').addEventListener('click',()=>stepImage(-1));
  $('nextEXR').addEventListener('click',()=>stepImage(1));
  $('exrSelect').addEventListener('change',loadEXR);
  $('sourceGamut').addEventListener('input',()=>{updateSourceStatus();window.updatePrismPreview()});
  for (const id of ['gamutWarning','splitPosition','prismGamut']) {
    $(id).addEventListener('input',window.updatePrismPreview);
  }
  $('savePreview').addEventListener('click',()=>cnv.toBlob(blob=>{
    if (!blob) return;
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);
    a.download=(imageEntries[Number($('exrSelect').value)]?.name||'prism').split('/').pop().replace(/\.exr$/i,'')+'-prism.png';a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  },'image/png'));
  if ($('outputMode').value==='hdr') selectOutput();
  refresh();
})();
