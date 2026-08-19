export const downloadAsFile = (
    content: string | ArrayBuffer | Blob,
    filename: string,
    mimeType = 'text/plain') => {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
