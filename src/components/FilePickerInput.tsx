import type { Ref } from 'react';

interface FilePickerInputProps {
    /** What Open clicks through. */
    ref: Ref<HTMLInputElement>;
    onFile: (file: File) => void;
}

/**
 * The hidden input Open reaches through.
 *
 * It resets its own value on change, or opening the same file twice in a row fires no `change`
 * event at all.
 */
export const FilePickerInput = ({ ref, onFile }: FilePickerInputProps) => (
    <input
        ref={ref}
        type="file"
        accept="application/xml,.mei,.zip,.mid,.midi"
        style={{ display: 'none' }}
        onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = '';
        }}
    />
);
