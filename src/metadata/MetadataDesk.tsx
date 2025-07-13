import { ViewProps } from "../TransformerViewProps";
import { AppInfo, Author } from "../../../mpm-ts/lib";
import { Button, Stack } from "@mui/material";
import { Add } from "@mui/icons-material";
import { AppInfoDisplay } from "./AppInfoDisplay";
import { AuthorDisplay } from "./AuthorDisplay";
import { createPortal } from "react-dom";
import { Ribbon } from "../Ribbon";

export const MetadataDesk = ({ mpm, setMPM, appBarRef }: ViewProps) => {
    return (
        <div>
            {createPortal((
                <Ribbon title='Metadata Actions'>
                    <Stack direction='row' spacing={1}>
                        <Button
                            startIcon={<Add />}
                            variant="contained"
                            size='small'
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
                            size='small'
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
                            size='small'
                        >
                            Add Related Resource
                        </Button>
                    </Stack>
                </Ribbon>
            ), appBarRef.current || document.body)}

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
        </div >
    )
}
