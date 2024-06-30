import { Slider } from "@mui/material"

type ZoomControlsProps = {
    setStretchX: (stretchX: number) => void
    setStretchY: (stretchY: number) => void
}

export const ZoomControls = ({ setStretchX, setStretchY }: ZoomControlsProps) => {
    return (
        <>
          <div className='horizontalStretch'>
            <Slider
              aria-label="Horizontal Stretch"
              valueLabelDisplay="auto"
              defaultValue={20} step={1} min={1} max={50} marks
              onChange={(_: Event, value: number | number[]) => setStretchX(value as number)}
            />
          </div>

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
              defaultValue={1} step={0.2} min={0.2} max={2} marks
              onChange={(_: Event, value: number | number[]) => setStretchY(value as number)}
            />
          </div>
        </>
    )
}