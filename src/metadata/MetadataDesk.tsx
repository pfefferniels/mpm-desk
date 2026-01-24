import { TransformerViewProps } from "../TransformerViewProps";
import { AppInfo, Author, Comment } from "../../../mpm-ts/lib";
import { Button, Card, Stack } from "@mui/material";
import { Add } from "@mui/icons-material";
import { AppInfoDisplay } from "./AppInfoDisplay";
import { MetadataFieldDisplay } from "./AuthorDisplay";
import { createPortal } from "react-dom";
import { Ribbon } from "../Ribbon";
import { InsertMetadata, AuthorOptions, CommentOptions } from "mpmify";

const buildMetadataOptions = (mpm: { doc: { metadata: Array<{ type: string; text?: string; number?: number }> } }) => {
    const authors: AuthorOptions[] = []
    const comments: CommentOptions[] = []

    for (const field of mpm.doc.metadata) {
        if (field.type === 'author') {
            authors.push({
                number: (field as Author).number,
                text: (field as Author).text
            })
        } else if (field.type === 'comment') {
            comments.push({
                text: (field as Comment).text
            })
        }
    }

    return { authors, comments }
}

export const MetadataDesk = ({ mpm, addTransformer, appBarRef }: TransformerViewProps<InsertMetadata>) => {
    const handleAddAuthor = () => {
        const options = buildMetadataOptions(mpm)
        options.authors.push({
            number: options.authors.length,
            text: 'John Doe'
        })
        addTransformer(new InsertMetadata(options), true)
    }

    const handleAddComment = () => {
        const options = buildMetadataOptions(mpm)
        options.comments.push({
            text: 'New Comment'
        })
        addTransformer(new InsertMetadata(options), true)
    }

    const handleAuthorChange = (index: number, author: Author) => {
        const options = buildMetadataOptions(mpm)
        options.authors[index] = {
            number: author.number,
            text: author.text
        }
        addTransformer(new InsertMetadata(options), true)
    }

    const handleAuthorRemove = (index: number) => {
        const options = buildMetadataOptions(mpm)
        options.authors.splice(index, 1)
        addTransformer(new InsertMetadata(options), true)
    }

    const handleCommentChange = (index: number, comment: Comment) => {
        const options = buildMetadataOptions(mpm)
        options.comments[index] = {
            text: comment.text
        }
        addTransformer(new InsertMetadata(options), true)
    }

    const handleCommentRemove = (index: number) => {
        const options = buildMetadataOptions(mpm)
        options.comments.splice(index, 1)
        addTransformer(new InsertMetadata(options), true)
    }

    return (
        <div>
            {appBarRef && createPortal((
                <Ribbon title='Metadata'>
                    <Stack direction='row' spacing={1}>
                        <Button
                            startIcon={<Add />}
                            variant="contained"
                            size='small'
                            onClick={handleAddAuthor}
                        >
                            Add Author
                        </Button>
                        <Button
                            size='small'
                            startIcon={<Add />}
                            variant="contained"
                            onClick={handleAddComment}
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
            ), appBarRef?.current ?? document.body)}

            <Card elevation={7} sx={{ margin: 2, maxWidth: '400px' }}>
                <Stack direction='column' spacing={2} m={2}>
                    {mpm.doc.metadata.filter(field => field.type === 'author').map((field, i) => (
                        <MetadataFieldDisplay
                            key={`author_${i}`}
                            label="Author"
                            field={field as Author}
                            onChange={author => handleAuthorChange(i, author)}
                            onRemove={() => handleAuthorRemove(i)}
                        />
                    ))}
                    {mpm.doc.metadata.filter(field => field.type === 'comment').map((field, i) => (
                        <MetadataFieldDisplay
                            key={`comment_${i}`}
                            label="Comment"
                            field={field as Comment}
                            onChange={comment => handleCommentChange(i, comment)}
                            onRemove={() => handleCommentRemove(i)}
                            multiline
                        />
                    ))}
                    {mpm.doc.metadata.filter(field => field.type === 'appInfo').map((field, i) => (
                        <AppInfoDisplay key={`appInfo_${i}`} appInfo={field as AppInfo} />
                    ))}
                </Stack>
            </Card>
        </div >
    )
}
