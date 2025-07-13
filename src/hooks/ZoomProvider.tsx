import { createContext, useContext } from 'react';

interface ZoomContextValue {
    symbolic: {
        stretchX: number
    },
    physical: {
        stretchX: number
    }
}

export const ZoomContext = createContext<ZoomContextValue>({
    symbolic: {
        stretchX: 20
    },
    physical: {
        stretchX: 20
    }
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

