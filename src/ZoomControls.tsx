import { Slider } from "@mui/material"

type OptionPair<P extends string, T> =
    | ({
        [K in `stretch${Capitalize<P>}`]: T;
    } & {
        [K in `setStretch${Capitalize<P>}`]: (value: T) => void;
    } & {
        [K in `range${Capitalize<P>}`]: [T, T];
    })
    | ({
        [K in `stretch${Capitalize<P>}`]?: T;
    } & {
        [K in `setStretch${Capitalize<P>}`]?: undefined;
    } & {
        [K in `range${Capitalize<P>}`]?: undefined;
    });

export type ZoomControlsProps = OptionPair<'x', number> & OptionPair<'y', number>;

export const ZoomControls = ({ stretchX, setStretchX, rangeX, stretchY, setStretchY, rangeY }: ZoomControlsProps) => {
    return (
        <>
            {(stretchX && rangeX) && (
                <div style={{ minWidth: 200 }}>
                    <Slider
                        aria-label="Horizontal Stretch"
                        valueLabelDisplay="auto"
                        defaultValue={rangeX[0] + (rangeX[1] - rangeX[0]) / 2}
                        step={0.5}
                        min={rangeX[0]} max={rangeX[1]}
                        marks
                        value={stretchX}
                        onChange={(_: Event, value: number | number[]) => setStretchX(value as number)}
                    />
                </div>
            )}

            {(stretchY && rangeY) && (
                <div className='verticalStretch'>
                    <Slider
                        sx={{
                            '& input[type="range"]': {
                                WebkitAppearance: 'slider-vertical',
                            },
                        }}
                        aria-label="Vertical Stretch"
                        orientation="vertical"
                        valueLabelDisplay="auto"
                        defaultValue={rangeY[0] + (rangeY[1] - rangeY[0]) / 2}
                        step={(rangeY[1] - rangeY[0]) / 10}
                        min={rangeY[0]}
                        max={rangeY[1]}
                        marks
                        value={stretchY}
                        onChange={(_: Event, value: number | number[]) => setStretchY(value as number)}
                    />
                </div>
            )}
        </>
    )
}
