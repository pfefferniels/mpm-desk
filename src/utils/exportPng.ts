async function svgElementToPngDataUrl(
    svgEl: SVGSVGElement,
    opts?: {
        width?: number;
        height?: number;
        scale?: number;      // e.g. 2 for retina
        background?: string; // e.g. "#fff" to avoid transparency
    }
): Promise<string> {
    const scale = opts?.scale ?? 1;

    // 1) Clone so we can safely tweak attributes without touching the live DOM
    const cloned = svgEl.cloneNode(true) as SVGSVGElement;

    // Ensure namespace
    cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    cloned.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

    // 2) Figure out output size
    // Prefer explicit opts, then width/height, then viewBox
    const vb = cloned.viewBox?.baseVal;
    const cssWidth = svgEl.clientWidth || (vb?.width ?? 0);
    const cssHeight = svgEl.clientHeight || (vb?.height ?? 0);

    const width = Math.max(1, Math.round(opts?.width ?? cssWidth));
    const height = Math.max(1, Math.round(opts?.height ?? cssHeight));

    // Set explicit size on the cloned SVG so the rasterization is stable
    cloned.setAttribute("width", String(width));
    cloned.setAttribute("height", String(height));

    // 3) Serialize SVG -> data URL
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(cloned);

    // Some SVGs need proper encoding; using base64 is generally robust
    const svgBase64 = btoa(unescape(encodeURIComponent(svgString)));
    const svgDataUrl = `data:image/svg+xml;base64,${svgBase64}`;

    // 4) Load into an Image
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        // If your SVG references external images/fonts, you may hit CORS tainting.
        // Setting crossOrigin helps only if the remote server sends proper CORS headers.
        i.crossOrigin = "anonymous";
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("Failed to load SVG as image"));
        i.src = svgDataUrl;
    });

    // 5) Draw to canvas
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D canvas context");

    if (opts?.background) {
        ctx.save();
        ctx.fillStyle = opts.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
    }

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.drawImage(img, 0, 0, width, height);

    // 6) Export PNG
    return canvas.toDataURL("image/png");
}

export async function svgElementToPngBlob(
    svgEl: SVGSVGElement,
    opts?: Parameters<typeof svgElementToPngDataUrl>[1]
): Promise<Blob> {
    const dataUrl = await svgElementToPngDataUrl(svgEl, opts);
    const res = await fetch(dataUrl);
    return await res.blob();
}
