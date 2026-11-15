/**
 * WebGL GLSL ES 1.00 Shaders
 * Mobile-compliant (zero dynamic array indexing), Dual-Kawase Down/Up filters,
 * and high-fidelity screen-space optical refraction compositor
 */

export const VS_SOURCE = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// 4-tap bilinear box downsampler
export const DOWNSAMPLE_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_halfPixel;

void main() {
  vec4 sum = texture2D(u_image, v_uv - u_halfPixel);
  sum += texture2D(u_image, v_uv + vec2(u_halfPixel.x, -u_halfPixel.y));
  sum += texture2D(u_image, v_uv + vec2(-u_halfPixel.x, u_halfPixel.y));
  sum += texture2D(u_image, v_uv + u_halfPixel);
  gl_FragColor = sum * 0.25;
}
`;

// 9-tap 3x3 tent upsampler (Dual-Kawase continuous reconstruction filter)
export const UPSAMPLE_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_halfPixel;

void main() {
  vec2 d = u_halfPixel;
  // Center (4/16) + Cross (4 * 2/16) + Corners (4 * 1/16) = 16/16 = 1.0
  vec4 sum = texture2D(u_image, v_uv) * 0.25;
  sum += (texture2D(u_image, v_uv - vec2(d.x, 0.0)) +
          texture2D(u_image, v_uv + vec2(d.x, 0.0)) +
          texture2D(u_image, v_uv - vec2(0.0, d.y)) +
          texture2D(u_image, v_uv + vec2(0.0, d.y))) * 0.125;
  sum += (texture2D(u_image, v_uv + vec2(-d.x, -d.y)) +
          texture2D(u_image, v_uv + vec2( d.x, -d.y)) +
          texture2D(u_image, v_uv + vec2(-d.x,  d.y)) +
          texture2D(u_image, v_uv + vec2( d.x,  d.y))) * 0.0625;
  gl_FragColor = sum;
}
`;

export const FS_SOURCE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_uv;

uniform vec2 u_resolution; // cluster canvas buffer resolution (e.g. 512, 1024, 2048)
uniform vec2 u_areaOrigin; // top-left world coordinate of cluster canvas in physical pixels
uniform vec2 u_stageResolution; // full viewport background resolution in physical pixels
uniform sampler2D u_source; // live background texture
uniform sampler2D u_lut;    // R: _T0, G: _T1, B: _T2, A: _T4
uniform sampler2D u_blur;   // live GPU-blurred background texture (1:1 native screen resolution)
uniform float u_frosted;    // frosted blur amount (0.0 = sharp, >0.0 = blurred)

uniform float u_rim;        // rim width in physical pixels
uniform float u_ior;        // index of refraction
uniform float u_height;     // glass height/thickness in physical pixels
uniform float u_fusionSpan; // fusion distance in physical pixels
uniform float u_count;      // number of glass elements (0..8)
uniform float u_dpr;        // device pixel ratio
uniform float u_hasFusedElements; // 1.0 = at least two elements are fused

// 8 Unrolled Element Uniforms (Mobile GLSL ES 1.00 compliant)
uniform vec4 u_rect0; uniform float u_rad0; uniform vec4 u_tint0; uniform float u_shape0; uniform float u_fused0;
uniform vec4 u_rect1; uniform float u_rad1; uniform vec4 u_tint1; uniform float u_shape1; uniform float u_fused1;
uniform vec4 u_rect2; uniform float u_rad2; uniform vec4 u_tint2; uniform float u_shape2; uniform float u_fused2;
uniform vec4 u_rect3; uniform float u_rad3; uniform vec4 u_tint3; uniform float u_shape3; uniform float u_fused3;
uniform vec4 u_rect4; uniform float u_rad4; uniform vec4 u_tint4; uniform float u_shape4; uniform float u_fused4;
uniform vec4 u_rect5; uniform float u_rad5; uniform vec4 u_tint5; uniform float u_shape5; uniform float u_fused5;
uniform vec4 u_rect6; uniform float u_rad6; uniform vec4 u_tint6; uniform float u_shape6; uniform float u_fused6;
uniform vec4 u_rect7; uniform float u_rad7; uniform vec4 u_tint7; uniform float u_shape7; uniform float u_fused7;

// Inigo Quilez 2D Rounded Box SDF with radius clamping
float sdRoundedBox(vec2 p, vec2 b, float r) {
  float rad = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + rad;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rad;
}

float evalElement(vec2 p, vec4 rect, float rad, float isCircle) {
  vec2 c = rect.xy;
  vec2 halfSize = rect.zw;
  vec2 rel = p - c;
  if (isCircle > 0.5) {
    return length(rel) - min(halfSize.x, halfSize.y);
  }
  return sdRoundedBox(rel, halfSize, rad);
}

// Quadratic smooth minimum: gives natural organic liquid attraction starting from distance < span.
// Strictly guarantees d <= min(d1, d2) so shapes never erode or tear holes.
float blendSurfaces(float d1, float d2, float span) {
  if (span <= 0.001) return min(d1, d2);
  float diff = abs(d1 - d2);
  if (diff >= span) return min(d1, d2);
  float h = span - diff;
  return min(d1, d2) - (h * h * 0.25) / span;
}

float mapScene(vec2 p) {
  if (u_count <= 0.5) return 9999.0;
  float d = evalElement(p, u_rect0, u_rad0, u_shape0);
  if (u_hasFusedElements < 0.5) return d;
  if (u_count > 1.5) d = blendSurfaces(d, evalElement(p, u_rect1, u_rad1, u_shape1), u_fusionSpan);
  if (u_count > 2.5) d = blendSurfaces(d, evalElement(p, u_rect2, u_rad2, u_shape2), u_fusionSpan);
  if (u_count > 3.5) d = blendSurfaces(d, evalElement(p, u_rect3, u_rad3, u_shape3), u_fusionSpan);
  if (u_count > 4.5) d = blendSurfaces(d, evalElement(p, u_rect4, u_rad4, u_shape4), u_fusionSpan);
  if (u_count > 5.5) d = blendSurfaces(d, evalElement(p, u_rect5, u_rad5, u_shape5), u_fusionSpan);
  if (u_count > 6.5) d = blendSurfaces(d, evalElement(p, u_rect6, u_rad6, u_shape6), u_fusionSpan);
  if (u_count > 7.5) d = blendSurfaces(d, evalElement(p, u_rect7, u_rad7, u_shape7), u_fusionSpan);
  return d;
}

// Distance field evaluated ONLY for elements that are currently coalescing/fused
float mapFusedScene(vec2 p) {
  float d = 9999.0;
  bool first = true;
  if (u_count > 0.5 && u_fused0 > 0.5) {
    d = evalElement(p, u_rect0, u_rad0, u_shape0);
    first = false;
  }
  if (u_count > 1.5 && u_fused1 > 0.5) {
    float d1 = evalElement(p, u_rect1, u_rad1, u_shape1);
    d = first ? d1 : blendSurfaces(d, d1, u_fusionSpan);
    first = false;
  }
  if (u_count > 2.5 && u_fused2 > 0.5) {
    float d2 = evalElement(p, u_rect2, u_rad2, u_shape2);
    d = first ? d2 : blendSurfaces(d, d2, u_fusionSpan);
    first = false;
  }
  if (u_count > 3.5 && u_fused3 > 0.5) {
    float d3 = evalElement(p, u_rect3, u_rad3, u_shape3);
    d = first ? d3 : blendSurfaces(d, d3, u_fusionSpan);
    first = false;
  }
  if (u_count > 4.5 && u_fused4 > 0.5) {
    float d4 = evalElement(p, u_rect4, u_rad4, u_shape4);
    d = first ? d4 : blendSurfaces(d, d4, u_fusionSpan);
    first = false;
  }
  if (u_count > 5.5 && u_fused5 > 0.5) {
    float d5 = evalElement(p, u_rect5, u_rad5, u_shape5);
    d = first ? d5 : blendSurfaces(d, d5, u_fusionSpan);
    first = false;
  }
  if (u_count > 6.5 && u_fused6 > 0.5) {
    float d6 = evalElement(p, u_rect6, u_rad6, u_shape6);
    d = first ? d6 : blendSurfaces(d, d6, u_fusionSpan);
    first = false;
  }
  if (u_count > 7.5 && u_fused7 > 0.5) {
    float d7 = evalElement(p, u_rect7, u_rad7, u_shape7);
    d = first ? d7 : blendSurfaces(d, d7, u_fusionSpan);
    first = false;
  }
  return d;
}

// Unified GPU drop shadow for all elements and liquid bridges
// Perfectly matches CSS box-shadow: 0 14px 28px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.06)
vec4 calcDropShadow(vec2 p) {
  vec2 off1 = vec2(0.0, 14.0 * u_dpr);
  float blur1 = 28.0 * u_dpr;
  float d1 = mapScene(p - off1);
  float a1 = smoothstep(0.0, 1.0, 0.5 - 0.5 * (d1 / blur1)) * 0.16;

  vec2 off2 = vec2(0.0, 2.0 * u_dpr);
  float blur2 = 6.0 * u_dpr;
  float d2 = mapScene(p - off2);
  float a2 = smoothstep(0.0, 1.0, 0.5 - 0.5 * (d2 / blur2)) * 0.06;

  float totalA = clamp(a1 + a2, 0.0, 1.0);
  return vec4(0.0, 0.0, 0.0, totalA);
}

vec2 calcGradient(vec2 p) {
  float eps = 1.5;
  float dx = (mapScene(vec2(p.x + eps, p.y)) - mapScene(vec2(p.x - eps, p.y))) * (0.5 / eps);
  float dy = (mapScene(vec2(p.x, p.y + eps)) - mapScene(vec2(p.x, p.y - eps))) * (0.5 / eps);
  return vec2(dx, dy);
}

void main() {
  // Convert WebGL bottom-left coordinate to canvas top-left local coordinate
  vec2 p_local = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
  // Map local coordinate to world physical coordinate on the stage
  vec2 p = u_areaOrigin + p_local;

  float d = mapScene(p);
  if (d > 0.5) {
    if (d < 44.0 * u_dpr) {
      vec4 shadow = calcDropShadow(p);
      if (shadow.a > 0.001) {
        gl_FragColor = shadow;
        return;
      }
    }
    gl_FragColor = vec4(0.0);
    return;
  }

  // Smooth subpixel antialiasing at the boundary
  float edgeAlpha = clamp(0.5 - d, 0.0, 1.0);
  if (edgeAlpha <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec4 tint = u_tint0;
  // Clear optical refraction when frosted = 0 (preserves 100% color fidelity);
  // smoothly blooms into rich milky frosted glass as frosted increases.
  float frostedFactor = clamp(u_frosted / 10.0, 0.0, 1.0);
  float activeTintA = mix(min(tint.a, 0.03), tint.a, frostedFactor);
  float invTA = 1.0 - activeTintA;

  vec2 offset = vec2(0.0);
  float topSheenVal = 0.0;
  float disp = 0.0;

  vec2 grad = vec2(0.0);
  float gradLen = 0.0;
  float slopeFactor = 0.0;
  vec2 norm = vec2(0.0);
  bool hasGrad = false;

  // Refraction physics strictly on the beveled rim, identical to CPU buildElementLUT / renderFusedCluster
  if (d < 0.0 && -d < u_rim) {
    float u = -d / max(u_rim, 1.0);
    vec4 lut = texture2D(u_lut, vec2((u * 255.0 + 0.5) / 256.0, 0.5));
    float gain = lut.r * 3.0;     // Unscale _T0 gain curve
    float sheen = lut.b * 32.0;   // Unscale _T2 sheen
    disp = lut.a * 0.025;         // Unscale _T4 chromatic dispersion

    grad = calcGradient(p);
    hasGrad = true;
    gradLen = length(grad);
    slopeFactor = clamp(gradLen, 0.0, 1.0);
    norm = gradLen > 0.0001 ? grad / gradLen : vec2(0.0);

    // Smooth sinusoidal displacement profile:
    // Strictly monotonic mapping prevents caustic inversion, upside-down text, and horizontal banding!
    float maxShift = min((u_ior - 1.0) * u_height, u_rim * 0.28);
    float shift = maxShift * sin(3.14159265 * u);
    offset = -norm * slopeFactor * shift;

    if (norm.y < -0.2) {
      topSheenVal = sheen * (-norm.y) * slopeFactor;
    }
  }

  // Border glint strictly within 3px of boundary (matching CPU |d| < 3.0)
  float glintVal = 0.0;
  float absD = abs(d);
  if (absD < 3.0) {
    float gPos = absD * 0.33;
    vec4 gLut = texture2D(u_lut, vec2((gPos * 255.0 + 0.5) / 256.0, 0.5));
    if (!hasGrad) {
      grad = calcGradient(p);
      gradLen = length(grad);
      slopeFactor = clamp(gradLen, 0.0, 1.0);
    }
    glintVal = gLut.g * 255.0 * slopeFactor;
  }

  // Chromatic dispersion: separate Red, Green and Blue ray paths (hardware direct UV)
  vec2 baseP = p + offset;
  vec2 uvG = vec2(baseP.x / u_stageResolution.x, baseP.y / u_stageResolution.y);
  vec2 pR = p + offset * (1.0 + disp);
  vec2 uvR = vec2(pR.x / u_stageResolution.x, pR.y / u_stageResolution.y);
  vec2 pB = p + offset * (1.0 - disp);
  vec2 uvB = vec2(pB.x / u_stageResolution.x, pB.y / u_stageResolution.y);

  vec3 sharpCol;
  if (disp > 0.0001) {
    sharpCol = vec3(
      texture2D(u_source, clamp(uvR, 0.0, 1.0)).r,
      texture2D(u_source, clamp(uvG, 0.0, 1.0)).g,
      texture2D(u_source, clamp(uvB, 0.0, 1.0)).b
    );
  } else {
    sharpCol = texture2D(u_source, clamp(uvG, 0.0, 1.0)).rgb;
  }

  vec3 bgCol;
  if (u_frosted > 0.001) {
    vec3 blurCol;
    if (disp > 0.0001) {
      blurCol = vec3(
        texture2D(u_blur, clamp(uvR, 0.0, 1.0)).r,
        texture2D(u_blur, clamp(uvG, 0.0, 1.0)).g,
        texture2D(u_blur, clamp(uvB, 0.0, 1.0)).b
      );
    } else {
      blurCol = texture2D(u_blur, clamp(uvG, 0.0, 1.0)).rgb;
    }
    float frostedMix = clamp(u_frosted, 0.0, 1.0);
    bgCol = mix(sharpCol, blurCol, frostedMix);
  } else {
    bgCol = sharpCol;
  }

  vec3 finalRgb;
  if (tint.a < 0.15) {
    float clearH = topSheenVal * 0.92 + glintVal * 0.88;
    finalRgb = bgCol * invTA + tint.rgb * activeTintA + vec3(clearH / 255.0);
  } else {
    float highlight = topSheenVal * 0.78 + glintVal * 0.65;
    finalRgb = bgCol * invTA + tint.rgb * activeTintA + vec3(
      highlight * 0.72 / 255.0,
      highlight * 0.88 / 255.0,
      highlight / 255.0
    );
  }

  // Correct Premultiplied Alpha for clean, halo-free antialiasing
  vec3 clampedRgb = clamp(finalRgb, 0.0, 1.0);
  gl_FragColor = vec4(clampedRgb * edgeAlpha, edgeAlpha);
}
`;
