import { input } from "gpu.js";

const CreateTexture = {
    name: "create-texture-unorm",
    inject: {
        "fs:#decl": "uniform sampler2D textureName;",
        "fs:DECKGL_FILTER_COLOR": "color = texture(textureName, geometry.uv);",
    },
    getUniforms: (props = {}) => ({
        textureName: props.textureName,
    }),
};

const getDeviceGl = (device) => {
    if (device && device.gl && typeof device.gl.bindTexture === "function") {
        return device.gl;
    }
    if (device && device.handle && typeof device.handle.bindTexture === "function") {
        return device.handle;
    }
    throw new Error("[renderTile] Unable to resolve WebGL context from luma device");
};

const BLIT_RESOURCES = new WeakMap();

const compileShader = (gl, type, source) => {
    const shader = gl.createShader(type);
    if (!shader) {
        throw new Error("[renderTile] Failed to create shader for texture blit");
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader) || "unknown shader compile error";
        gl.deleteShader(shader);
        throw new Error(`[renderTile] Texture blit shader compile failed: ${log}`);
    }

    return shader;
};

const getBlitResources = (gl) => {
    let resources = BLIT_RESOURCES.get(gl);
    if (resources) {
        return resources;
    }

        const vertexSource = `#version 300 es
out vec2 vUv;
void main() {
    vec2 pos;
    vec2 uv;

    if (gl_VertexID == 0) {
        pos = vec2(-1.0, -1.0);
        uv = vec2(0.0, 0.0);
    } else if (gl_VertexID == 1) {
        pos = vec2(1.0, -1.0);
        uv = vec2(1.0, 0.0);
    } else if (gl_VertexID == 2) {
        pos = vec2(-1.0, 1.0);
        uv = vec2(0.0, 1.0);
    } else {
        pos = vec2(1.0, 1.0);
        uv = vec2(1.0, 1.0);
    }

    vUv = uv;
    gl_Position = vec4(pos, 0.0, 1.0);
}`;

    const fragmentSource = `#version 300 es
precision highp float;
uniform sampler2D uSource;
in vec2 vUv;
out vec4 outColor;
void main() {
  outColor = texture(uSource, vUv);
}`;

    const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram();
    if (!program) {
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        throw new Error("[renderTile] Failed to create shader program for texture blit");
    }

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program) || "unknown program link error";
        gl.deleteProgram(program);
        throw new Error(`[renderTile] Texture blit program link failed: ${log}`);
    }

    const vao = gl.createVertexArray();
    if (!vao) {
        gl.deleteProgram(program);
        throw new Error("[renderTile] Failed to create VAO for texture blit");
    }

    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) {
        gl.deleteVertexArray(vao);
        gl.deleteProgram(program);
        throw new Error("[renderTile] Failed to create framebuffer for texture blit");
    }

    const sourceUniform = gl.getUniformLocation(program, "uSource");
    resources = { program, vao, framebuffer, sourceUniform };
    BLIT_RESOURCES.set(gl, resources);
    return resources;
};

const detectSourceTextureFormat = (gl, sourceTexture) => {
    const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const probeFramebuffer = gl.createFramebuffer();
    if (!probeFramebuffer) {
        return "rgba8unorm";
    }

    let detectedFormat = "rgba8unorm";
    try {
        gl.bindFramebuffer(gl.FRAMEBUFFER, probeFramebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sourceTexture, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            return "rgba8unorm";
        }

        const componentType = gl.getFramebufferAttachmentParameter(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0,
            gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE
        );

        if (componentType === gl.FLOAT) {
            detectedFormat = "rgba16float";
        } else {
            detectedFormat = "rgba8unorm";
        }
    } catch (_error) {
        detectedFormat = "rgba8unorm";
    } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
        gl.deleteFramebuffer(probeFramebuffer);
    }

    return detectedFormat;
};

const captureGLState = (gl) => ({
    viewport: gl.getParameter(gl.VIEWPORT),
    scissorBox: gl.getParameter(gl.SCISSOR_BOX),
    depthTest: gl.isEnabled(gl.DEPTH_TEST),
    stencilTest: gl.isEnabled(gl.STENCIL_TEST),
    scissorTest: gl.isEnabled(gl.SCISSOR_TEST),
    cullFace: gl.isEnabled(gl.CULL_FACE),
    blend: gl.isEnabled(gl.BLEND),
    colorMask: gl.getParameter(gl.COLOR_WRITEMASK),
});
const restoreGLState = (gl, state) => {
    if (state.depthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
    if (state.stencilTest) gl.enable(gl.STENCIL_TEST); else gl.disable(gl.STENCIL_TEST);
    if (state.scissorTest) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
    if (state.cullFace) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
    if (state.blend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
};

const ensureLumaTexture = (tileDataResult, width, height, format) => {
    const device = tileDataResult && tileDataResult.device;
    if (!device || typeof device.createTexture !== "function") {
        throw new Error("[renderTile] Missing luma device; cannot build RasterModule texture");
    }

    let texture = tileDataResult._lumaTexture || null;
    const needsNewTexture =
        !texture ||
        texture.destroyed ||
        texture.width !== width ||
        texture.height !== height ||
        tileDataResult._lumaTextureFormat !== format;

    if (needsNewTexture) {
        if (texture && typeof texture.destroy === "function" && !texture.destroyed) {
            texture.destroy();
        }
        texture = device.createTexture({
            format,
            width,
            height,
            mipmaps: false,
            sampler: {
                minFilter: "nearest",
                magFilter: "nearest",
                addressModeU: "clamp-to-edge",
                addressModeV: "clamp-to-edge",
            },
        });
        tileDataResult._lumaTexture = texture;
        tileDataResult._lumaTextureFormat = format;
    }

    return texture;
};

const copyGpuTextureToLumaTexture = (device, sourceTexture, targetTexture, width, height) => {
    const gl = getDeviceGl(device);
    const blit = getBlitResources(gl);

    const readFramebuffer = gl.createFramebuffer();
    if (!readFramebuffer) {
        throw new Error("[renderTile] Failed to create read framebuffer for texture copy");
    }

    const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const previousReadFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    const previousDrawFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    const previousProgram = gl.getParameter(gl.CURRENT_PROGRAM);
    const previousVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    const previousActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
    const previousTexture2D = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const previousViewport = gl.getParameter(gl.VIEWPORT);
    const previousScissorBox = gl.getParameter(gl.SCISSOR_BOX);
    const previousDepthTest = gl.isEnabled(gl.DEPTH_TEST);
    const previousStencilTest = gl.isEnabled(gl.STENCIL_TEST);
    const previousScissorTest = gl.isEnabled(gl.SCISSOR_TEST);
    const previousCullFace = gl.isEnabled(gl.CULL_FACE);
    const previousBlend = gl.isEnabled(gl.BLEND);
    const previousColorMask = gl.getParameter(gl.COLOR_WRITEMASK);

    try {
        // Isolate blit draw from deck/luma state to avoid silent clipping/discard.
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.STENCIL_TEST);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.BLEND);
        gl.colorMask(true, true, true, true);

        // Preferred path: framebuffer blit does exact texel copy without UV sampling.
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFramebuffer);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sourceTexture, 0);
        const readStatus = gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER);

        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, blit.framebuffer);
        gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, targetTexture.handle, 0);
        const drawStatus = gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER);

        if (readStatus === gl.FRAMEBUFFER_COMPLETE && drawStatus === gl.FRAMEBUFFER_COMPLETE) {
            gl.blitFramebuffer(
                0,
                0,
                width,
                height,
                0,
                0,
                width,
                height,
                gl.COLOR_BUFFER_BIT,
                gl.NEAREST
            );

            const blitFramebufferError = gl.getError();
            if (blitFramebufferError === gl.NO_ERROR) {
                return;
            }
        }

        // Fallback path: shader blit for environments where framebuffer blit fails.
        gl.bindFramebuffer(gl.FRAMEBUFFER, blit.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, targetTexture.handle, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error(`[renderTile] Incomplete framebuffer during texture blit (status: ${status})`);
        }

        gl.viewport(0, 0, width, height);
        gl.useProgram(blit.program);
        gl.bindVertexArray(blit.vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
        // Guarantee source texture completeness for sampling in the blit shader.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(blit.sourceUniform, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        const blitError = gl.getError();
        if (blitError !== gl.NO_ERROR) {
            throw new Error(`[renderTile] Texture blit draw failed with GL error code ${blitError}`);
        }
    } finally {
        gl.deleteFramebuffer(readFramebuffer);
        gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousReadFramebuffer);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDrawFramebuffer);
        gl.useProgram(previousProgram);
        gl.bindVertexArray(previousVao);
        gl.activeTexture(previousActiveTexture);
        gl.bindTexture(gl.TEXTURE_2D, previousTexture2D);
        gl.viewport(previousViewport[0], previousViewport[1], previousViewport[2], previousViewport[3]);
        gl.scissor(previousScissorBox[0], previousScissorBox[1], previousScissorBox[2], previousScissorBox[3]);
        restoreGLState(gl, {
            depthTest: previousDepthTest,
            stencilTest: previousStencilTest,
            scissorTest: previousScissorTest,
            cullFace: previousCullFace,
            blend: previousBlend
        });
        gl.colorMask(previousColorMask[0], previousColorMask[1], previousColorMask[2], previousColorMask[3]);
    }
};

const toRasterModules = (tileDataResult, gpuTexture, width, height) => {
    const device = tileDataResult && tileDataResult.device;
    const gl = getDeviceGl(device);
    const handle = gpuTexture && (gpuTexture.texture || gpuTexture);
    if (!handle) {
        throw new Error("[renderTile] GPU.js pipeline did not produce a texture handle");
    }

    const sourceFormat = detectSourceTextureFormat(gl, handle);
    const formatsToTry = sourceFormat === "rgba16float"
        ? ["rgba16float", "rgba8unorm"]
        : ["rgba8unorm", "rgba16float"];

    let lumaTexture = null;
    let lastError = null;
    for (let i = 0; i < formatsToTry.length; i++) {
        const format = formatsToTry[i];
        try {
            lumaTexture = ensureLumaTexture(tileDataResult, width, height, format);
            copyGpuTextureToLumaTexture(device, handle, lumaTexture, width, height);
            lastError = null;
            break;
        } catch (error) {
            lastError = error;
        }
    }

    if (!lumaTexture || lastError) {
        throw new Error(`[renderTile] Failed to copy GPU texture into luma texture: ${lastError ? lastError.message : "unknown error"}`);
    }

    return [
        {
            module: CreateTexture,
            props: { textureName: lumaTexture },
        },
    ];
};

const extractGpuTextureHandle = (kernelOutput, kernel) => {
    if (kernelOutput && kernelOutput.texture) {
        return kernelOutput.texture;
    }
    if (kernelOutput && typeof kernelOutput === "object") {
        if (kernelOutput.texture && kernelOutput.texture.texture) {
            return kernelOutput.texture.texture;
        }
        if (kernelOutput.webGlTexture) {
            return kernelOutput.webGlTexture;
        }
    }

    // Graphical kernels may not return the texture object directly.
    if (kernel && kernel.texture) {
        return kernel.texture;
    }
    if (kernel && kernel.kernel && kernel.kernel.texture) {
        return kernel.kernel.texture;
    }

    return null;
};

const runKernelWithIsolatedState = (device, kernel, kernelArgs, width, height) => {
    const gl = getDeviceGl(device);

    const previousState = captureGLState(gl);

    try {
        // Prevent deck/luma state from clipping GPU.js offscreen draws.
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.STENCIL_TEST);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.BLEND);
        gl.colorMask(true, true, true, true);
        gl.viewport(0, 0, width, height);
        // Support both single argument and multiple arguments for pipelined kernels
        return Array.isArray(kernelArgs) ? kernel(...kernelArgs) : kernel(kernelArgs);
    } finally {
        gl.viewport(previousState.viewport[0], previousState.viewport[1], previousState.viewport[2], previousState.viewport[3]);
        gl.scissor(previousState.scissorBox[0], previousState.scissorBox[1], previousState.scissorBox[2], previousState.scissorBox[3]);
        restoreGLState(gl, previousState);
        gl.colorMask(previousState.colorMask[0], previousState.colorMask[1], previousState.colorMask[2], previousState.colorMask[3]);
    }
};

/**
 * Generate a 256-entry color lookup table from gradient colors and stops
 * Performs linear interpolation between stops on CPU to avoid GPU.js limitations
 * @param {Array<Array<number>>} colors - RGBA colors (normalized 0-1)
 * @param {Array<number>} stops - Scalar stop values
 * @param {number[]|null} domain - Optional scalar domain [min, max]
 * @returns {Array<Array<number>>} 256x4 color LUT
 */
const generateColorLUT = (colors, stops, domain = null) => {
    const lut = [];
    const numStops = stops.length;

    let domainMin = -1.0;
    let domainMax = 1.0;
    if (Array.isArray(domain) && domain.length === 2) {
        const parsedMin = Number(domain[0]);
        const parsedMax = Number(domain[1]);
        if (Number.isFinite(parsedMin) && Number.isFinite(parsedMax) && parsedMax > parsedMin) {
            domainMin = parsedMin;
            domainMax = parsedMax;
        }
    }
    const domainRange = domainMax - domainMin;

    for (let i = 0; i < 256; i++) {
        const t = i / 255.0;
        const scalarVal = domainMin + t * domainRange;

        if (scalarVal <= stops[0]) {
            lut.push([...colors[0]]);
            continue;
        }
        if (scalarVal >= stops[numStops - 1]) {
            lut.push([...colors[numStops - 1]]);
            continue;
        }

        let segmentIdx = 0;
        for (let j = 0; j < numStops - 1; j++) {
            if (scalarVal >= stops[j] && scalarVal < stops[j + 1]) {
                segmentIdx = j;
                break;
            }
        }

        const t0 = stops[segmentIdx];
        const t1 = stops[segmentIdx + 1];
        const localT = (scalarVal - t0) / (t1 - t0);

        const c0 = colors[segmentIdx];
        const c1 = colors[segmentIdx + 1];

        lut.push([
            c0[0] * (1 - localT) + c1[0] * localT,
            c0[1] * (1 - localT) + c1[1] * localT,
            c0[2] * (1 - localT) + c1[2] * localT,
            c0[3] * (1 - localT) + c1[3] * localT
        ]);
    }

    return lut;
};

/**
 * Render a tile using the active style from the multiband instance
 * @param {Object} tileDataResult - The tile data with texture information
 * @param {Object} multibandInstance - The multiband instance with GPU and style management
 * @returns {Array} RasterModule[]
 */
const renderTile = (tileDataResult, multibandInstance) => {
    if (tileDataResult && tileDataResult.data) {
        const [data, rawWidth, rawHeight, bandCount] = [
            tileDataResult.data,
            tileDataResult.width,
            tileDataResult.height,
            tileDataResult.bandCount
        ];
        const width = Math.max(1, Math.floor(Number(rawWidth) || 0));
        const height = Math.max(1, Math.floor(Number(rawHeight) || 0));

        const activeStyle = multibandInstance._styles.find(s => s.name === multibandInstance._activeStyleName);
        if (!activeStyle) {
            throw new Error('[renderTile] No active style found');
        }

        const render = multibandInstance._getActiveStyleKernel();
        if (!render) {
            throw new Error('[renderTile] No active style kernel available');
        }

        render.setOutput([width, height]);

        const kernelInput = input(data, [width, height, bandCount]);
        let kernelOutput = runKernelWithIsolatedState(tileDataResult.device, render, kernelInput, width, height);

        let finalKernel = render;

        if (activeStyle.rgbaColors && activeStyle.stops && multibandInstance._coloringKernel) {
            const coloringKernel = multibandInstance._coloringKernel;
            coloringKernel.setOutput([width, height]);

            const styleDomain = activeStyle.domain || [-1.0, 1.0];
            const domainMin = styleDomain[0];
            const domainMax = styleDomain[1];

            if (!activeStyle.colorLUT) {
                activeStyle.colorLUT = generateColorLUT(activeStyle.rgbaColors, activeStyle.stops, styleDomain);
            }

            kernelOutput = runKernelWithIsolatedState(
                tileDataResult.device,
                coloringKernel,
                [kernelOutput, activeStyle.colorLUT, domainMin, domainMax],
                width,
                height
            );
            finalKernel = coloringKernel;
        }

        const textureHandle = extractGpuTextureHandle(kernelOutput, finalKernel);
        if (textureHandle) {
            return toRasterModules(tileDataResult, textureHandle, width, height);
        }
        throw new Error("[renderTile] GPU.js kernel did not expose a texture handle");

    } else {
        throw new Error('[renderTile] Missing tile data for GPU render');
    }
};

export { renderTile };
