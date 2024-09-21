import { TransformerViewProps } from "../TransformerViewProps";
import { AppInfo, Author } from "../../../mpm-ts/lib";
import { Button, Stack } from "@mui/material";
import { Add } from "@mui/icons-material";
import { AppInfoDisplay } from "./AppInfoDisplay";
import { AuthorDisplay } from "./AuthorDisplay";

export const MetadataDesk = ({ mpm, setMPM }: TransformerViewProps) => {
    return (
        <div>
            <Stack direction='column' spacing={2}>
                {mpm.doc.metadata.map((field, i) => {
                    if (field.type === 'appInfo') {
                        return <AppInfoDisplay key={`${field}_${i}`} appInfo={field as AppInfo} />
                    }
                    else if (field.type === 'author') {
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
                    }
                })}
            </Stack>

            <Stack
                direction='row'
                sx={{ marginTop: '2rem' }}
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
        </div>
    )
}
