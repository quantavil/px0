import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { compressImageToWebP } from "../src/client/image-compress";

describe("Client-Side WebP Image Compression", () => {
  let originalCreateImageBitmap: typeof globalThis.createImageBitmap;
  let originalDocument: typeof globalThis.document;

  beforeEach(() => {
    originalCreateImageBitmap = globalThis.createImageBitmap;
    originalDocument = globalThis.document;
  });

  afterEach(() => {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  });

  function setupMockBrowserEnvironment(options?: {
    bmpWidth?: number;
    bmpHeight?: number;
    webpSupported?: boolean;
    failFromImage?: boolean;
  }) {
    const bmpWidth = options?.bmpWidth ?? 1920;
    const bmpHeight = options?.bmpHeight ?? 1080;
    const webpSupported = options?.webpSupported ?? true;
    const failFromImage = options?.failFromImage ?? false;

    let bmpClosed = false;
    let drawnWidth = 0;
    let drawnHeight = 0;
    let passedQuality = 0;
    let passedMime = "";

    const mockBmp = {
      width: bmpWidth,
      height: bmpHeight,
      close() {
        bmpClosed = true;
      },
    };

    let firstCall = true;
    globalThis.createImageBitmap = (async (
      _file: unknown,
      opts?: { imageOrientation?: string },
    ) => {
      if (
        opts?.imageOrientation === "from-image" &&
        failFromImage &&
        firstCall
      ) {
        firstCall = false;
        throw new Error("imageOrientation not supported");
      }
      return mockBmp as unknown as ImageBitmap;
    }) as unknown as typeof createImageBitmap;

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext(type: string) {
        if (type !== "2d") return null;
        return {
          drawImage(
            _img: unknown,
            _sx: number,
            _sy: number,
            dw: number,
            dh: number,
          ) {
            drawnWidth = dw;
            drawnHeight = dh;
          },
        };
      },
      toDataURL(mime: string, quality?: number) {
        passedMime = mime;
        passedQuality = quality ?? 0;
        if (mime === "image/webp") {
          if (!webpSupported) {
            return "data:image/png;base64,mockPng";
          }
          return `data:image/webp;base64,mockWebP_q${quality}`;
        }
        if (mime === "image/jpeg") {
          return `data:image/jpeg;base64,mockJpeg_q${quality}`;
        }
        return "data:image/png;base64,mockPng";
      },
    };

    globalThis.document = {
      createElement(tag: string) {
        if (tag === "canvas") return mockCanvas as unknown as HTMLElement;
        return {} as HTMLElement;
      },
    } as unknown as Document;

    return {
      getBmpClosed: () => bmpClosed,
      getDrawnDims: () => ({ width: drawnWidth, height: drawnHeight }),
      getCanvasDims: () => ({
        width: mockCanvas.width,
        height: mockCanvas.height,
      }),
      getPassedQuality: () => passedQuality,
      getPassedMime: () => passedMime,
    };
  }

  test("scales down landscape image exceeding 1280px to max 1280px keeping aspect ratio", async () => {
    const harness = setupMockBrowserEnvironment({
      bmpWidth: 2560,
      bmpHeight: 1440,
    });
    const dummyFile = new File(["dummy"], "landscape.png", {
      type: "image/png",
    });

    const result = await compressImageToWebP(dummyFile);

    expect(result).toStartWith("data:image/webp;base64,");
    expect(harness.getCanvasDims()).toEqual({ width: 1280, height: 720 });
    expect(harness.getDrawnDims()).toEqual({ width: 1280, height: 720 });
    expect(harness.getPassedQuality()).toBe(0.65);
    expect(harness.getBmpClosed()).toBe(true);
  });

  test("scales down portrait image exceeding 1280px to max 1280px keeping aspect ratio", async () => {
    const harness = setupMockBrowserEnvironment({
      bmpWidth: 1000,
      bmpHeight: 2000,
    });
    const dummyFile = new File(["dummy"], "portrait.jpg", {
      type: "image/jpeg",
    });

    const result = await compressImageToWebP(dummyFile);

    expect(result).toStartWith("data:image/webp;base64,");
    expect(harness.getCanvasDims()).toEqual({ width: 640, height: 1280 });
    expect(harness.getDrawnDims()).toEqual({ width: 640, height: 1280 });
    expect(harness.getBmpClosed()).toBe(true);
  });

  test("preserves original dimensions for images smaller than maxDim (1280px)", async () => {
    const harness = setupMockBrowserEnvironment({
      bmpWidth: 800,
      bmpHeight: 600,
    });
    const dummyFile = new File(["dummy"], "small.png", { type: "image/png" });

    const result = await compressImageToWebP(dummyFile);

    expect(result).toStartWith("data:image/webp;base64,");
    expect(harness.getCanvasDims()).toEqual({ width: 800, height: 600 });
    expect(harness.getDrawnDims()).toEqual({ width: 800, height: 600 });
    expect(harness.getBmpClosed()).toBe(true);
  });

  test("accepts custom maxDim and quality overrides", async () => {
    const harness = setupMockBrowserEnvironment({
      bmpWidth: 1000,
      bmpHeight: 1000,
    });
    const dummyFile = new File(["dummy"], "custom.png", { type: "image/png" });

    const result = await compressImageToWebP(dummyFile, 500, 0.8);

    expect(result).toStartWith("data:image/webp;base64,");
    expect(harness.getCanvasDims()).toEqual({ width: 500, height: 500 });
    expect(harness.getPassedQuality()).toBe(0.8);
    expect(harness.getBmpClosed()).toBe(true);
  });

  test("falls back to image/jpeg if canvas does not support image/webp export", async () => {
    const harness = setupMockBrowserEnvironment({
      bmpWidth: 800,
      bmpHeight: 600,
      webpSupported: false,
    });
    const dummyFile = new File(["dummy"], "fallback.png", {
      type: "image/png",
    });

    const result = await compressImageToWebP(dummyFile);

    expect(result).toStartWith("data:image/jpeg;base64,");
    expect(harness.getBmpClosed()).toBe(true);
  });

  test("falls back to parameterless createImageBitmap if imageOrientation option throws", async () => {
    const harness = setupMockBrowserEnvironment({
      bmpWidth: 640,
      bmpHeight: 480,
      failFromImage: true,
    });
    const dummyFile = new File(["dummy"], "safari.jpg", { type: "image/jpeg" });

    const result = await compressImageToWebP(dummyFile);

    expect(result).toStartWith("data:image/webp;base64,");
    expect(harness.getCanvasDims()).toEqual({ width: 640, height: 480 });
    expect(harness.getBmpClosed()).toBe(true);
  });

  test("closes ImageBitmap even if canvas context fails", async () => {
    let bmpClosed = false;
    globalThis.createImageBitmap = (async () => ({
      width: 100,
      height: 100,
      close() {
        bmpClosed = true;
      },
    })) as unknown as typeof createImageBitmap;

    globalThis.document = {
      createElement: () => ({
        getContext: () => null,
      }),
    } as unknown as Document;

    const dummyFile = new File(["dummy"], "err.png", { type: "image/png" });
    await expect(compressImageToWebP(dummyFile)).rejects.toThrow(
      "Unable to obtain 2D canvas",
    );
    expect(bmpClosed).toBe(true);
  });

  test("throws error when image has invalid (zero or negative) dimensions and closes bitmap", async () => {
    const harness = setupMockBrowserEnvironment({
      bmpWidth: 0,
      bmpHeight: 0,
    });
    const dummyFile = new File(["dummy"], "zero.png", { type: "image/png" });
    await expect(compressImageToWebP(dummyFile)).rejects.toThrow(
      "Invalid image dimensions",
    );
    expect(harness.getBmpClosed()).toBe(true);
  });
});
