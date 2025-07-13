import { Stack } from "@mui/material"

interface RibbonProps {
    title: string
    children: React.ReactNode
}

export const Ribbon = ({ children, title }: RibbonProps) => {
    return (
        <Stack p={1}>
            <span style={{ textAlign: 'center' }}>{title}</span>
            <Stack direction='row'>
                {children}
            </Stack>
        </Stack>
    )
}
