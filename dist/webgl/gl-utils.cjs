/**
 * WebGL Helper Utilities
 * Shader compilation, program linking, and optical LUT texture generation
 */

const { _T0, _T1, _T2, _T4 } = require('../tables.cjs');

/**
 * Compiles a WebGL shader from GLSL source
 * @param {WebGLRenderingContext} gl
 * @param {number} type - gl.VERTEX_SHADER or gl.FRAGMENT_SHADER
 * @param {string} source - GLSL source code
 * @returns {WebGLShader}
 */
exports.compileShader = function compileShader(gl, type, source) {
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

/**
 * Creates and links a WebGL program from vertex and fragment shaders
 * @param {WebGLRenderingContext} gl
 * @param {string} vsSource - Vertex shader GLSL
 * @param {string} fsSource - Fragment shader GLSL
 * @returns {WebGLProgram}
 */
exports.createProgram = function createProgram(gl, vsSource, fsSource) {
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

/**
 * Packs precomputed empirical tables into a 256x1 RGBA8 texture:
 * R: _T0 (Fresnel gain curve, scaled / 3.0)
 * G: _T1 (Edge glint highlight)
 * B: _T2 (Top specular sheen, scaled / 32.0)
 * A: _T4 (Chromatic dispersion, scaled / 0.025)
 * @returns {Uint8Array} Packed 1024-byte RGBA buffer
 */
exports.createLutTextureData = function createLutTextureData() {
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
