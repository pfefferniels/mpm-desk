import { Slider } from "@mui/material"

type ZoomControlsProps = {
    stretchX: number
    setStretchX: (stretchX: number) => void
}

export const PedalZoom = ({ /*stretchX,*/ setStretchX }: ZoomControlsProps) => {
    return (
        <>
          <div className='horizontalStretch'>
            <Slider
              aria-label="Horizontal Stretch"
              valueLabelDisplay="auto"
              defaultValue={2}
              step={0.1}
              min={0.01}
              max={3}
              marks
              onChange={(_: Event, value: number | number[]) => setStretchX(value as number)}
            />
          </div>
        </>
    )
}