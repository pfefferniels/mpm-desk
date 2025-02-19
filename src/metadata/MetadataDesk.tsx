import { TransformerViewProps } from "../TransformerViewProps";
import { AppInfo, Author } from "../../../mpm-ts/lib";
import { Button, Stack } from "@mui/material";
import { Add } from "@mui/icons-material";
import { AppInfoDisplay } from "./AppInfoDisplay";
import { AuthorDisplay } from "./AuthorDisplay";

export const MetadataDesk = ({ mpm, setMPM }: TransformerViewProps) => {
    return (
        <div>
            <Stack
                direction='row'
                spacing={2}
            >
                <Button
                    startIcon={<Add />}
                    variant="contained"
                    onClick={() => {
                        mpm.doc.metadata.push({
                            type: 'author',
                            number: 0,
                            text: 'John Doe'
                        })

                        setMPM(mpm.clone())
                    }}
                >
                    Add Author
                </Button>
                <Button
                    startIcon={<Add />}
                    variant="contained"
                    onClick={() => {
                        mpm.doc.metadata.push({
                            type: 'comment',
                            text: 'John Doe'
                        })

                        setMPM(mpm.clone())
                    }}
                >
                    Add Comment
                </Button>
                <Button
                    startIcon={<Add />}
                    variant="contained"
                >
                    Add Related Resource
                </Button>
            </Stack>

            <Stack direction='column' spacing={2} m={2}>
                {mpm.doc.metadata.filter(field => field.type === 'author').map((field, i) => {
                    return (
                        <AuthorDisplay
                            key={`${field}_${i}`}
                            author={field as Author}
                            onChange={author => {
                                (field as Author).text = author.text
                                setMPM(mpm.clone())
                            }}
                            onRemove={() => {
                                mpm.doc.metadata.splice(mpm.doc.metadata.indexOf(field), 1)
                                setMPM(mpm.clone())
                            }}
                        />
                    )
                })}
                {mpm.doc.metadata.filter(field => field.type === 'appInfo').map((field, i) => {
                    return <AppInfoDisplay key={`${field}_${i}`} appInfo={field as AppInfo} />
                })}
            </Stack>
        </div>
    )
}
