import { Box, Slider } from "@mui/material"

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

type ZoomControlsProps = OptionPair<'x', number> & OptionPair<'y', number>;

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

            {/* The vertical slider's wrapper was `.verticalStretch` in `src/App.css`. Its
                declarations are unchanged: auto top and bottom margins against a stated height
                are the old trick for centring an absolutely positioned box vertically. It moves
                here because the containing block it positions itself against belongs to
                `TempoDesk`, and a stylesheet two directories away could not say so — the rule's
                whole meaning sat in a class name that only this one element ever used. */}
            {(stretchY && rangeY) && (
                <Box sx={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    marginTop: 'auto',
                    marginBottom: 'auto',
                    height: 300,
                }}>
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
                </Box>
            )}
        </>
    )
}
