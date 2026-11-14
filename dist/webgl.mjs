/**
 * High-Performance 2D WebGL Screen-Space Liquid Glass Compositor
 * 100% Mobile GLSL ES 1.00 Compliant (Zero dynamic array indexing).
 * Uses exact C1-continuous blendSurfaces matching empirical _T3 calibration table.
 * Strictly guarantees d <= min(d1, d2) so shapes never erode or tear holes.
 */

import { _T0, _T1, _T2, _T4 } from './tables.mjs';

const VS_SOURCE = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FS_SOURCE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_uv;

uniform vec2 u_resolution; // viewport resolution in physical pixels
uniform sampler2D u_source; // live background texture
uniform sampler2D u_lut;    // R: _T0, G: _T1, B: _T2, A: _T4

uniform float u_rim;        // rim width in physical pixels
uniform float u_ior;        // index of refraction
uniform float u_height;     // glass height/thickness in physical pixels
uniform float u_fusionSpan; // fusion distance in physical pixels
uniform int u_count;        // number of glass elements (0..8)

// 8 Unrolled Element Uniforms (Mobile GLSL ES 1.00 compliant)
uniform vec4 u_rect0; uniform float u_rad0; uniform vec4 u_tint0; uniform float u_shape0;
uniform vec4 u_rect1; uniform float u_rad1; uniform vec4 u_tint1; uniform float u_shape1;
uniform vec4 u_rect2; uniform float u_rad2; uniform vec4 u_tint2; uniform float u_shape2;
uniform vec4 u_rect3; uniform float u_rad3; uniform vec4 u_tint3; uniform float u_shape3;
uniform vec4 u_rect4; uniform float u_rad4; uniform vec4 u_tint4; uniform float u_shape4;
uniform vec4 u_rect5; uniform float u_rad5; uniform vec4 u_tint5; uniform float u_shape5;
uniform vec4 u_rect6; uniform float u_rad6; uniform vec4 u_tint6; uniform float u_shape6;
uniform vec4 u_rect7; uniform float u_rad7; uniform vec4 u_tint7; uniform float u_shape7;

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

// Empirical _T3 Bridge Blend: guarantees d <= min(d1, d2) so shapes never erode or tear holes
float blendSurfaces(float d1, float d2, float span) {
  if (span <= 0.001) return min(d1, d2);
  float diff = abs(d1 - d2);
  if (diff >= span) return min(d1, d2);
  float h = span - diff;
  return min(d1, d2) - (h * h * 0.25) / span;
}

float mapScene(vec2 p) {
  if (u_count <= 0) return 9999.0;
  float d = evalElement(p, u_rect0, u_rad0, u_shape0);
  if (u_count > 1) d = blendSurfaces(d, evalElement(p, u_rect1, u_rad1, u_shape1), u_fusionSpan);
  if (u_count > 2) d = blendSurfaces(d, evalElement(p, u_rect2, u_rad2, u_shape2), u_fusionSpan);
  if (u_count > 3) d = blendSurfaces(d, evalElement(p, u_rect3, u_rad3, u_shape3), u_fusionSpan);
  if (u_count > 4) d = blendSurfaces(d, evalElement(p, u_rect4, u_rad4, u_shape4), u_fusionSpan);
  if (u_count > 5) d = blendSurfaces(d, evalElement(p, u_rect5, u_rad5, u_shape5), u_fusionSpan);
  if (u_count > 6) d = blendSurfaces(d, evalElement(p, u_rect6, u_rad6, u_shape6), u_fusionSpan);
  if (u_count > 7) d = blendSurfaces(d, evalElement(p, u_rect7, u_rad7, u_shape7), u_fusionSpan);
  return d;
}

vec2 calcGradient(vec2 p) {
  float eps = 1.0;
  float dx = (mapScene(vec2(p.x + eps, p.y)) - mapScene(vec2(p.x - eps, p.y))) * 0.5;
  float dy = (mapScene(vec2(p.x, p.y + eps)) - mapScene(vec2(p.x, p.y - eps))) * 0.5;
  return vec2(dx, dy);
}

void main() {
  // Convert WebGL bottom-left coordinate to canvas top-left physical pixel coordinate
  vec2 p = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);

  float d = mapScene(p);
  if (d > 1.0) {
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
  float invTA = 1.0 - tint.a;

  // Normalized distance from boundary into lens [0.0 = boundary, 1.0 = interior flat region]
  float u = clamp(-d / max(u_rim, 1.0), 0.0, 1.0);

  // Hardware bilinear LUT lookup in a single GPU clock cycle
  vec4 lut = texture2D(u_lut, vec2(u, 0.5));
  float gain = lut.r * 3.0;     // Unscale _T0 gain curve
  float glint = lut.g * 255.0;  // Unscale _T1 glint
  float sheen = lut.b * 32.0;   // Unscale _T2 sheen
  float disp = lut.a * 0.025;   // Unscale _T4 chromatic dispersion

  // Smooth gradient and continuous ray displacement (zero singularity in fusion necks)
  vec2 grad = calcGradient(p);
  float gradLen = length(grad);
  float slopeFactor = clamp(gradLen, 0.0, 1.0);
  vec2 norm = gradLen > 0.0001 ? grad / gradLen : vec2(0.0);

  float shift = gain * (u_ior - 1.0) * u_height;
  vec2 offset = -norm * slopeFactor * min(shift, u_rim * 1.25);

  // Specular sheen along the top-lit rim (extinguished in fusion necks)
  float topSheenVal = 0.0;
  if (norm.y < -0.15) {
    topSheenVal = sheen * (-norm.y) * slopeFactor;
  }

  // Subtle border highlight strictly on sharp outer boundaries, zero inside fused necks
  float glintVal = 0.0;
  if (abs(d) < 2.0) {
    float gFactor = (2.0 - abs(d)) / 2.0;
    glintVal = gFactor * 4.0 * slopeFactor;
  }

  // Chromatic dispersion: separate Red, Green and Blue ray paths
  vec2 baseP = p + offset;
  vec2 uvG = vec2(baseP.x / u_resolution.x, 1.0 - baseP.y / u_resolution.y);
  vec2 pR = p + offset * (1.0 + disp);
  vec2 uvR = vec2(pR.x / u_resolution.x, 1.0 - pR.y / u_resolution.y);
  vec2 pB = p + offset * (1.0 - disp);
  vec2 uvB = vec2(pB.x / u_resolution.x, 1.0 - pB.y / u_resolution.y);

  float rBg = texture2D(u_source, clamp(uvR, 0.0, 1.0)).r;
  float gBg = texture2D(u_source, clamp(uvG, 0.0, 1.0)).g;
  float bBg = texture2D(u_source, clamp(uvB, 0.0, 1.0)).b;
  vec3 bgCol = vec3(rBg, gBg, bBg);

  float highlight = topSheenVal * 0.78 + glintVal * 0.65;
  vec3 finalRgb;
  if (tint.a < 0.15) {
    float clearH = topSheenVal * 0.92 + glintVal * 0.88;
    finalRgb = bgCol * invTA + tint.rgb * tint.a + vec3(clearH / 255.0);
  } else {
    finalRgb = bgCol * invTA + tint.rgb * tint.a + vec3(
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

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${info}`);
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link failed: ${info}`);
  }
  return prog;
}

function createLutTextureData() {
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const r = Math.min(255, Math.max(0, Math.round((_T0[i] / 3.0) * 255)));
    const g = Math.min(255, Math.max(0, Math.round(_T1[i])));
    const b = Math.min(255, Math.max(0, Math.round((_T2[i] / 32.0) * 255)));
    const a = Math.min(255, Math.max(0, Math.round((_T4[i] / 0.025) * 255)));
    const idx = i * 4;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = a;
  }
  return data;
}

export class WebGLGlassRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl =
      canvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        premultipliedAlpha: true
      }) ||
      canvas.getContext('experimental-webgl', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        premultipliedAlpha: true
      });

    if (!this.gl) {
      throw new Error('WebGL not supported');
    }

    const gl = this.gl;
    this.program = createProgram(gl, VS_SOURCE, FS_SOURCE);

    // Quad geometry
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    // Uniform locations
    this.uResolution = gl.getUniformLocation(this.program, 'u_resolution');
    this.uSource = gl.getUniformLocation(this.program, 'u_source');
    this.uLut = gl.getUniformLocation(this.program, 'u_lut');
    this.uRim = gl.getUniformLocation(this.program, 'u_rim');
    this.uIor = gl.getUniformLocation(this.program, 'u_ior');
    this.uHeight = gl.getUniformLocation(this.program, 'u_height');
    this.uFusionSpan = gl.getUniformLocation(this.program, 'u_fusionSpan');
    this.uCount = gl.getUniformLocation(this.program, 'u_count');

    // 8 Unrolled shape uniforms
    this.shapeSlots = [];
    for (let i = 0; i < 8; i++) {
      this.shapeSlots.push({
        rect: gl.getUniformLocation(this.program, `u_rect${i}`),
        rad: gl.getUniformLocation(this.program, `u_rad${i}`),
        tint: gl.getUniformLocation(this.program, `u_tint${i}`),
        shape: gl.getUniformLocation(this.program, `u_shape${i}`)
      });
    }

    // Source background texture
    this.sourceTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Precomputed optical LUT texture
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    this.lutTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      256,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      createLutTextureData()
    );
  }

  render({ sourceCanvas, elements, options = {}, dpr = 1 }) {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w <= 0 || h <= 0) return;

    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);

    // 1. Upload background source canvas directly to GPU texture (zero-copy GPU path)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    try {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        sourceCanvas
      );
    } catch {
      return;
    }
    gl.uniform1i(this.uSource, 0);

    // 2. Bind precomputed optical LUT
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.uniform1i(this.uLut, 1);

    // 3. Set optical parameters
    const rimPx = Math.max(1, (options.rim || 16) * dpr);
    const heightPx = (options.height || 18) * dpr;
    const ior = options.ior || 1.46;
    const fusionDistance = typeof options.fusionDistance === 'number' ? options.fusionDistance : 56;
    const fusionSpan = options.fusion ? fusionDistance * dpr : 0;

    gl.uniform2f(this.uResolution, w, h);
    gl.uniform1f(this.uRim, rimPx);
    gl.uniform1f(this.uIor, ior);
    gl.uniform1f(this.uHeight, heightPx);
    gl.uniform1f(this.uFusionSpan, fusionSpan);

    const count = Math.min(8, elements.length);
    gl.uniform1i(this.uCount, count);

    for (let i = 0; i < 8; i++) {
      const slot = this.shapeSlots[i];
      if (i < count) {
        const el = elements[i];
        const cx = (el.x + el.w * 0.5) * dpr;
        const cy = (el.y + el.h * 0.5) * dpr;
        const halfW = el.w * 0.5 * dpr;
        const halfH = el.h * 0.5 * dpr;
        const r = Math.min((el.borderRadius || 0) * dpr, halfW, halfH);
        const isCircle =
          el.shape === 'circle' ||
          (Math.abs(halfW - halfH) < 1.0 && Math.abs(r - halfW) < 1.0);

        gl.uniform4f(slot.rect, cx, cy, halfW, halfH);
        gl.uniform1f(slot.rad, r);
        gl.uniform1f(slot.shape, isCircle ? 1.0 : 0.0);

        const tint = el.tint || [255, 255, 255, 0.05];
        gl.uniform4f(
          slot.tint,
          tint[0] / 255.0,
          tint[1] / 255.0,
          tint[2] / 255.0,
          tint[3]
        );
      } else {
        gl.uniform4f(slot.rect, 0, 0, 0, 0);
        gl.uniform1f(slot.rad, 0);
        gl.uniform1f(slot.shape, 0);
        gl.uniform4f(slot.tint, 0, 0, 0, 0);
      }
    }

    // 4. Quad position attribute
    const aPos = gl.getAttribLocation(this.program, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // 5. Draw! (1 draw call executes all elements and fusion on GPU)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy() {
    if (!this.gl) return;
    const gl = this.gl;
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
    if (this.sourceTex) gl.deleteTexture(this.sourceTex);
    if (this.lutTex) gl.deleteTexture(this.lutTex);
    if (this.program) gl.deleteProgram(this.program);
    this.gl = null;
  }
}
