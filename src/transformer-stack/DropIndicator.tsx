import { Box, BoxProps } from '@mui/material';
import { styled } from '@mui/material/styles';

type Edge = 'top' | 'right' | 'bottom' | 'left';
type Orientation = 'horizontal' | 'vertical';

const edgeToOrientationMap: Record<Edge, Orientation> = {
  top: 'horizontal',
  bottom: 'horizontal',
  left: 'vertical',
  right: 'vertical',
};

const strokeSize = 2;
const terminalSize = 8;
const offsetToAlignTerminalWithLine = (strokeSize - terminalSize) / 2;

export interface DropIndicatorProps extends BoxProps {
  edge: Edge;
  gap: string;
}

/**
 * DropIndicator component, MUI styled version.
 */
export const DropIndicator = styled(
  // We extract edge and gap so they are not passed to the DOM element.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ({ edge, gap, ...other }: DropIndicatorProps) => <Box {...other} />
)(({ edge, gap, theme }) => {
  const lineOffset = `calc(-0.5 * (${gap} + ${strokeSize}px))`;
  const orientation = edgeToOrientationMap[edge];

  // Define CSS variables and base styles.
  const baseStyles: Record<string, string | number> = {
    position: 'absolute',
    zIndex: 10,
    backgroundColor: theme.palette.primary.dark, // using primary.dark (blue-ish)
    pointerEvents: 'none',
    '--line-thickness': `${strokeSize}px`,
    '--line-offset': lineOffset,
    '--terminal-size': `${terminalSize}px`,
    '--terminal-radius': `${terminalSize / 2}px`,
    '--negative-terminal-size': `-${terminalSize}px`,
    '--offset-terminal': `${offsetToAlignTerminalWithLine}px`,
  };

  // Orientation-based styles.
  if (orientation === 'horizontal') {
    Object.assign(baseStyles, {
      height: 'var(--line-thickness)',
      left: 'var(--terminal-radius)',
      right: 0,
    });
  } else {
    Object.assign(baseStyles, {
      width: 'var(--line-thickness)',
      top: 'var(--terminal-radius)',
      bottom: 0,
    });
  }

  // Edge-based overrides.
  switch (edge) {
    case 'top':
      baseStyles.top = 'var(--line-offset)';
      break;
    case 'bottom':
      baseStyles.bottom = 'var(--line-offset)';
      break;
    case 'left':
      baseStyles.left = 'var(--line-offset)';
      break;
    case 'right':
      baseStyles.right = 'var(--line-offset)';
      break;
  }

  // Styles for the pseudo-element (the “terminal”).
  const beforeStyles: Record<string, string> = {
    content: '""',
    position: 'absolute',
    boxSizing: 'border-box',
    width: 'var(--terminal-size)',
    height: 'var(--terminal-size)',
    borderStyle: 'solid',
    borderWidth: 'var(--line-thickness)',
    borderColor: theme.palette.primary.dark,
    borderRadius: '50%',
  };

  // Orientation-based pseudo-element placement.
  if (orientation === 'horizontal') {
    beforeStyles.left = 'var(--negative-terminal-size)';
  } else {
    beforeStyles.top = 'var(--negative-terminal-size)';
  }

  // Edge-based pseudo-element adjustments.
  switch (edge) {
    case 'top':
      beforeStyles.top = 'var(--offset-terminal)';
      break;
    case 'bottom':
      beforeStyles.bottom = 'var(--offset-terminal)';
      break;
    case 'left':
      beforeStyles.left = 'var(--offset-terminal)';
      break;
    case 'right':
      beforeStyles.right = 'var(--offset-terminal)';
      break;
  }

  return {
    ...baseStyles,
    '&::before': beforeStyles,
  };
});

export default DropIndicator;
