import { createContext, useContext } from 'react';

interface ZoomContextValue {
    symbolic: {
        stretchX: number
    },
    physical: {
        stretchX: number
    },
    setStretchX: (value: number) => void
}

export const ZoomContext = createContext<ZoomContextValue>({
    symbolic: {
        stretchX: 20
    },
    physical: {
        stretchX: 20
    },
    setStretchX: () => {}
});

// Helper hooks

export const useSymbolicZoom = (): number => {
    const context = useContext(ZoomContext);
    if (!context) {
        throw new Error('useZoom must be used within a ZoomProvider');
    }
    return context.symbolic.stretchX;
};

export const usePhysicalZoom = (): number => {
    const context = useContext(ZoomContext);
    if (!context) {
        throw new Error('useZoom must be used within a ZoomProvider');
    }
    return context.physical.stretchX;
};

export const useZoom = () => {
    const context = useContext(ZoomContext);
    if (!context) {
        throw new Error('useZoom must be used within a ZoomProvider');
    }
    return { stretchX: context.physical.stretchX, setStretchX: context.setStretchX };
};

